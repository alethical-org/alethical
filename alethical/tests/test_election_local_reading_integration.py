"""Real sealed generations must carry local approval and original source closure."""

# ruff: noqa: F811, F401
from copy import deepcopy
from datetime import UTC, date, datetime
import hashlib
import json
from types import SimpleNamespace
from functools import wraps

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import election_external_finance as s
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.election_external_adapters import register_external_adapters
from alethical.pipeline.election_comparison import (
    archive_source,
    digest,
    ComparisonImportError,
)
from alethical.api.services import election_external_finance_reads as reads
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_source_review_concurrency import isolated_engine
from alethical.tests.test_election_local_sources import packet


@pytest.fixture
def db(isolated_engine, monkeypatch):
    # This module writes reviewed history and then calls public read services.
    # Those are separate real transactions: READ COMMITTED writes and pinned
    # REPEATABLE READ requests. Never weaken either production requirement.
    engine = isolated_engine
    with engine.begin() as connection:
        names = [
            n for n in inspect(connection).get_table_names() if n != "alembic_version"
        ]
        quoted = [connection.dialect.identifier_preparer.quote(n) for n in names]
        connection.execute(text("TRUNCATE " + ", ".join(quoted) + " CASCADE"))
    with Session(engine) as writer:

        def request_wrapper(fn):
            @wraps(fn)
            def request(db, *args, **kwargs):
                assert db is writer
                writer.commit()
                with engine.connect().execution_options(
                    isolation_level="REPEATABLE READ"
                ) as connection:
                    with Session(connection) as reader:
                        return fn(reader, *args, **kwargs)

            return request

        for name in ("candidate_finance", "bulk_finance"):
            monkeypatch.setattr(reads, name, request_wrapper(getattr(reads, name)))
        yield writer


@pytest.fixture
def local_generation(db, monkeypatch, request):
    monkeypatch.setattr(s, "ADAPTERS", {})
    register_external_adapters()
    body, bodies, receipt, source = packet(
        office="County Commissioner District 3",
        blank_inkind=getattr(request, "param", False),
    )
    store = MemoryStore()
    ballot = (
        b"03939001;Synthetic Candidate;0393;County Commissioner District 3;18;90;NP\n"
    )
    local_roster = b"0000000000001;Other Local;1000;Mayor;01;00001;\n"
    for value in (ballot, local_roster):
        bodies[hashlib.sha256(value).hexdigest()] = value
    for value in bodies.values():
        archive_source(db, store, value)
    decision = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="PRIVATE_SOURCE_REVIEWER",
        reason="PRIVATE_SOURCE_REASON",
        expected_previous_id=None,
    )
    rid = decision.receipt_sha256
    ctx = readings.load_verified_reading_context(
        db, store, [rid], allowed_source_hashes=set(bodies)
    )
    values = local.verified_local_context(ctx, rid).values()
    now = datetime(2026, 11, 12, 12, tzinfo=UTC)
    metadata = []
    urls = {
        receipt["original_sha256"]: source["url"],
        receipt["source_context"]["publisher_source_sha256"]: receipt["source_context"][
            "publisher_url"
        ],
        receipt["source_context"]["catalogue_source_sha256"]: receipt["source_context"][
            "catalogue_url"
        ],
    }
    bh = hashlib.sha256(ballot).hexdigest()
    lh = hashlib.sha256(local_roster).hexdigest()
    for h, value in bodies.items():
        metadata.append(
            dict(
                sha256=h,
                authority="local:county:18" if h in urls else None,
                url=urls.get(
                    h,
                    "https://electionresultsfiles.sos.mn.gov/20261103/"
                    + (
                        "LocalCandTbl.txt"
                        if h == lh
                        else "Cntytbl.txt"
                        if value.startswith(b"18;")
                        else "cand.txt"
                    ),
                ),
                file="cand.txt" if h == bh else "LocalCandTbl.txt" if h == lh else h,
                media_type="application/pdf"
                if h == source["sha256"]
                else "text/html"
                if h in urls
                else "text/plain",
                copied_at=now.isoformat(),
            )
        )
    snapshot = m.ElectionComparisonSnapshot(
        id=digest("local reading integration snapshot"),
        election_key="mn-2026-11-03-general",
        election_date=date(2026, 11, 3),
        stage="general",
        fetched_at=now,
        sources=[r for r in metadata if r["sha256"] in {bh, lh}],
        coverage={},
    )
    db.add(snapshot)
    db.flush()
    candidate = dict(
        candidate_id="03939001",
        candidate_stable_id="cand:201:2026-11-03:general:18:0393:03939001",
        name="Synthetic Candidate",
        party="NP",
        is_write_in_aggregate=False,
        votes=1,
    )
    race = m.ElectionComparisonRace(
        snapshot_id=snapshot.id,
        id=digest("local reading integration race"),
        label="County Commissioner District 3",
        office_id="0393",
        jurisdiction="18",
        result_status="unofficial",
        payload=dict(
            office_name="County Commissioner District 3",
            district=None,
            candidate_source_sha256=bh,
            candidates=[candidate],
        ),
    )
    db.add(race)
    db.flush()

    def binding(kind, field=None):
        locator = dict(kind=kind, receipt_sha256=rid)
        adapter = "local_checked_reading:v1"
        h = source["sha256"]
        if kind == "authority":
            h = receipt["source_context"]["publisher_source_sha256"]
        if field is not None:
            locator["field_id"] = field
        info = next(r for r in metadata if r["sha256"] == h)
        actual = local.extract_local_reading(bodies[h], info, locator, context=ctx)
        return dict(
            source_sha256=h,
            adapter=adapter,
            locator=locator,
            quote=actual.quote,
            facts=actual.facts,
        )

    authority = values["authority"] | dict(
        status="checked", binding=binding("authority")
    )
    account = values["account"] | dict(status="checked", binding=binding("account"))
    report = values["report"] | dict(
        report_key=digest(["local report", receipt["original_sha256"]]),
        source_sha256=receipt["original_sha256"],
        check_status="checked",
        binding=binding("report"),
        figures=[],
    )
    figure_binding = binding("figure", "cover.total_received")
    figure = {
        k: v
        for k, v in figure_binding["facts"].items()
        if k not in {"authority", "account_id", "source_report_id"}
    } | dict(binding=figure_binding)
    report["figures"] = [figure]
    coverage = [
        row
        | dict(
            authority=None,
            status="unmatched",
            next_action="Explicit local candidate/account review",
        )
        for row in s.expected_coverage(snapshot, [race], bodies)
    ]
    generation = s.prepare_generation(
        dict(
            format=1,
            election_key=snapshot.election_key,
            snapshot_id=snapshot.id,
            copied_at=now.isoformat(),
            sources=metadata,
            authorities=[authority],
            accounts=[account],
            reports=[report],
            payments=[],
            coverage=coverage,
        )
    )
    args = dict(
        snapshot_id=snapshot.id,
        race_id=race.id,
        candidate_id=candidate["candidate_id"],
        registration_number=account["account_id"],
        authority=account["authority"],
        decision="confirmed",
        identity=reviews.candidate_identity(race, candidate),
        period_start=date(2026, 8, 29),
        period_end=date(2026, 10, 19),
        reason="PRIVATE_ACCOUNT_REASON",
        reviewed_by="PRIVATE_ACCOUNT_REVIEWER",
        expected_previous_id=None,
        evidence=[
            dict(
                kind="ballot",
                sha256=bh,
                row_number=1,
                literal_row=ballot.decode().strip(),
            ),
            *[
                dict(
                    kind=kind,
                    sha256=bind["source_sha256"],
                    generation_id=generation["id"],
                    binding=bind,
                    **extra,
                )
                for kind, bind, extra in [
                    ("authority", authority["binding"], {}),
                    ("committee_register", account["binding"], {}),
                    (
                        "report_cover",
                        report["binding"],
                        {"report_key": report["report_key"]},
                    ),
                ]
            ],
        ],
    )
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: store)
    return SimpleNamespace(
        g=generation,
        store=store,
        originals=bodies,
        reading=decision,
        receipt=receipt,
        args=args,
        race=race,
        candidate=candidate,
        report=report,
    )


def publish(db, ctx):
    s.stage_generation(db, ctx.store, ctx.g, ctx.originals)
    s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
    reviews.record_decision(db, **ctx.args)


def test_local_checked_generation_stage_publish_and_read_uses_real_gates(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    data = reads.candidate_finance(
        db,
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    assert data["accounts"] and data["reports"][0]["figures"][0]["value"] == "1482.11"
    serialized = json.dumps(data)
    assert "PRIVATE_" not in serialized and ctx.reading.receipt_sha256 not in serialized


def test_stage_rejects_unapproved_receipt_and_wrong_generation_closure(
    db, local_generation
):
    ctx = local_generation
    bad = deepcopy(ctx.g)
    bad["reports"][0]["figures"][0]["binding"]["locator"]["receipt_sha256"] = "f" * 64
    bad["id"] = s.generation_digest(bad)
    with pytest.raises(ComparisonImportError):
        s.stage_generation(db, ctx.store, bad, ctx.originals)
    bad = deepcopy(ctx.g)
    county = ctx.receipt["source_context"]["county_source_sha256"]
    bad["sources"] = [row for row in bad["sources"] if row["sha256"] != county]
    bad["id"] = s.generation_digest(bad)
    with pytest.raises(ComparisonImportError):
        s.stage_generation(
            db, ctx.store, bad, {h: b for h, b in ctx.originals.items() if h != county}
        )


def test_withdrawal_changes_same_bytes_pins_withholds_and_restores(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    first = reads.candidate_finance(db, **query)
    withdrawn = readings.record_reading(
        db,
        ctx.store,
        receipt=ctx.receipt,
        decision="withdrawn",
        reviewed_by="private",
        reason="Withdraw checked source reading",
        expected_previous_id=ctx.reading.id,
    )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=first["version"])
    assert error.value.status_code == 409
    fresh = reads.candidate_finance(db, **query)
    assert (
        fresh["version"] != first["version"]
        and fresh["accounts"] == []
        and fresh["account_gaps"]
    )
    with pytest.raises(ComparisonImportError):
        s.publish_generation(
            db, ctx.store, ctx.g["id"], expected_previous=ctx.g["id"], restore=True
        )
    readings.record_reading(
        db,
        ctx.store,
        receipt=ctx.receipt,
        decision="checked",
        reviewed_by="private",
        reason="Recheck same exact original fields",
        expected_previous_id=withdrawn.id,
    )
    recovered = reads.candidate_finance(db, **query)
    assert recovered["accounts"] and recovered["version"] not in {
        first["version"],
        fresh["version"],
    }


def test_source_context_loss_changes_pin_and_keeps_source_missing_not_zero(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    first = reads.candidate_finance(db, **query)
    h = ctx.receipt["source_context"]["catalogue_source_sha256"]
    key = db.get(m.ElectionResultSource, h).object_key
    original = ctx.store.objects.pop(key)
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=first["version"])
    assert error.value.status_code == 409
    fresh = reads.candidate_finance(db, **query)
    assert fresh["accounts"] == [] and fresh["reports"] == []
    ctx.store.objects[key] = original
    assert reads.candidate_finance(db, **query)["version"] == first["version"]


def second_retained_generation(db, ctx):
    """Same visible form under different retained PDF bytes, no amendment claim."""
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter

    source_hash = ctx.receipt["original_sha256"]
    writer = PdfWriter()
    writer.append_pages_from_reader(PdfReader(BytesIO(ctx.originals[source_hash])))
    writer.add_metadata({"/Title": "Synthetic independent retained edition"})
    output = BytesIO()
    writer.write(output)
    body = output.getvalue()
    new_hash = hashlib.sha256(body).hexdigest()
    archive_source(db, ctx.store, body)
    receipt = readings.prepare_receipt(
        body,
        fields=ctx.receipt["fields"],
        document_kind="financial_report",
        source_context=ctx.receipt["source_context"],
    )
    decision = readings.record_reading(
        db,
        ctx.store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Synthetic second exact original",
        expected_previous_id=None,
    )
    report_key = digest(["second retained local report", new_hash])
    generation = json.loads(
        json.dumps(ctx.g)
        .replace(source_hash, new_hash)
        .replace(ctx.reading.receipt_sha256, decision.receipt_sha256)
        .replace(ctx.report["report_key"], report_key)
    )
    generation["id"] = s.generation_digest(generation)
    originals = {h: b for h, b in ctx.originals.items() if h != source_hash} | {
        new_hash: body
    }
    s.stage_generation(db, ctx.store, generation, originals)
    s.publish_generation(db, ctx.store, generation["id"], expected_previous=ctx.g["id"])
    return generation


@pytest.mark.parametrize(
    "failure",
    ["bytes", "metadata", "withdraw", "correct", "changed_head_while_unavailable"],
)
def test_exact_historical_reading_and_originals_govern_current_relationship(
    db, local_generation, failure
):
    ctx = local_generation
    publish(db, ctx)
    second = second_retained_generation(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    before = reads.candidate_finance(db, **query)
    assert before["generation_id"] == second["id"] and before["accounts"]
    original = db.get(m.ElectionResultSource, ctx.receipt["original_sha256"])
    old_bytes = ctx.store.objects[original.object_key]
    old_size = original.byte_size
    changed = None
    if failure in {"bytes", "changed_head_while_unavailable"}:
        ctx.store.objects[original.object_key] = b"changed original"
    elif failure == "metadata":
        original.byte_size += 1
        db.flush()
    elif failure == "withdraw":
        changed = readings.record_reading(
            db,
            ctx.store,
            receipt=ctx.receipt,
            decision="withdrawn",
            reviewed_by="private",
            reason="Withdraw historical proof",
            expected_previous_id=ctx.reading.id,
        )
    else:
        fields = deepcopy(ctx.receipt["fields"])
        fields.append(
            readings.field_proposal(
                "footer.checked_text",
                page=1,
                bounds=[45, 705, 585, 730],
                label="Source footer",
                literal="Private address phone signature not a payee",
                record_type="other",
            )
        )
        correction = readings.prepare_receipt(
            ctx.originals[ctx.receipt["original_sha256"]],
            fields=fields,
            document_kind="financial_report",
            source_context=ctx.receipt["source_context"],
        )
        changed = readings.record_reading(
            db,
            ctx.store,
            receipt=correction,
            decision="checked",
            reviewed_by="private",
            reason="Check another exact source field",
            expected_previous_id=ctx.reading.id,
        )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=before["version"])
    assert error.value.status_code == 409
    unavailable = reads.candidate_finance(db, **query)
    assert unavailable["accounts"] == [] and unavailable["account_gaps"]
    if failure == "changed_head_while_unavailable":
        changed = readings.record_reading(
            db,
            ctx.store,
            receipt=ctx.receipt,
            decision="withdrawn",
            reviewed_by="private",
            reason="Withdraw unavailable historical reading",
            expected_previous_id=ctx.reading.id,
        )
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(db, **query, version=unavailable["version"])
        assert error.value.status_code == 409
        again = reads.candidate_finance(db, **query)
        assert again["accounts"] == [] and again["version"] != unavailable["version"]
    ctx.store.objects[original.object_key] = old_bytes
    original.byte_size = old_size
    db.flush()
    if changed is not None:
        readings.record_reading(
            db,
            ctx.store,
            receipt=ctx.receipt,
            decision="checked",
            reviewed_by="private",
            reason="Exact historical fields checked again",
            expected_previous_id=changed.id,
        )
    recovered = reads.candidate_finance(db, **query)
    assert (
        recovered["accounts"]
        and recovered["reports"][0]["figures"][0]["value"] == "1482.11"
    )
    assert (
        recovered["version"] == before["version"]
        if changed is None
        else recovered["version"] != before["version"]
    )


def test_scoped_projection_uses_only_relevant_reading_descriptors_and_no_full_payload(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    parent = db.get(m.ElectionExternalFinanceGeneration, ctx.g["id"])
    db.expire(parent, ["payload"])
    _, view = s.load_published_view(
        db,
        parent,
        {(ctx.g["accounts"][0]["authority"], ctx.g["accounts"][0]["account_id"])},
        stable_id=ctx.candidate["candidate_stable_id"],
    )
    assert "payload" not in parent.__dict__
    assert set(view.reading_requirements) == {ctx.reading.receipt_sha256}
    assert set(ctx.originals) >= set(
        view.reading_requirements[ctx.reading.receipt_sha256]["original_hashes"]
    )
    # An unrelated exact account key cannot fetch this group's PDFs or receipts.
    _, other = s.load_published_view(
        db, parent, {("local:county:99", "other")}, stable_id="unrelated"
    )
    assert not other["reports"] and not other.reading_requirements


def test_caller_context_and_same_name_adapter_forgery_cannot_bypass_source_checks(
    db, local_generation, monkeypatch
):
    ctx = local_generation
    bad = deepcopy(ctx.g)
    bad["reports"][0]["figures"][0]["binding"]["locator"]["context"] = {
        "checked": True,
        "facts": bad["reports"][0]["figures"][0]["binding"]["facts"],
    }
    bad["id"] = s.generation_digest(bad)
    with pytest.raises(ComparisonImportError):
        s.stage_generation(db, ctx.store, bad, ctx.originals)
    monkeypatch.setitem(
        s.ADAPTERS,
        "local_checked_reading:v1",
        lambda *a, **kw: s.CheckedExtraction({}, "forged"),
    )
    with pytest.raises(ComparisonImportError):
        s.stage_generation(db, ctx.store, ctx.g, ctx.originals)


@pytest.mark.parametrize("local_generation", [True], indirect=True)
def test_checked_blank_field_is_a_source_gap_without_hiding_other_figures(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    data = reads.candidate_finance(
        db,
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    report = data["reports"][0]
    assert report["figures"][0]["value"] == "1482.11"
    gap = next(
        g
        for g in report["source_field_gaps"]
        if g["measure"] == "in_kind_contributions"
    )
    assert gap["state"] == "blank" and gap["literal"] == ""
    assert gap["sources"][0]["locator"]["page"] == 1
    assert not report["withheld_measures"] and not report["unavailable_measures"]
    assert ctx.reading.receipt_sha256 not in json.dumps(data)


def test_bulk_read_plans_reading_proof_once_without_render_or_ocr(
    db, local_generation, monkeypatch
):
    ctx = local_generation
    publish(db, ctx)
    calls = []
    original = readings.load_verified_reading_context

    def traced(*args, **kwargs):
        calls.append(set(args[2]))
        return original(*args, **kwargs)

    monkeypatch.setattr(readings, "load_verified_reading_context", traced)
    monkeypatch.setattr(
        readings,
        "render_page",
        lambda *a, **kw: pytest.fail("ordinary read rendered PDF"),
    )
    data = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert data["candidates"][0]["reports"][0]["figures"][0]["value"] == "1482.11"
    assert calls == [{ctx.reading.receipt_sha256}]


@pytest.mark.parametrize("fail_at", [2, 3])
def test_evicted_source_failure_is_in_pin_before_any_figures_are_returned(
    db, local_generation, monkeypatch, fail_at
):
    from threading import Lock
    from alethical.api.services.election_source_io import FreshReadStore

    ctx = local_generation
    publish(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
    )
    good = reads.candidate_finance(db, **query, store=ctx.store)
    key = db.get(m.ElectionResultSource, ctx.receipt["original_sha256"]).object_key

    class Flaky:
        def __init__(self):
            self.count = 0
            self.lock = Lock()

        def get(self, target, path, *, max_bytes=None):
            if target == key:
                with self.lock:
                    self.count += 1
                    if self.count >= fail_at:
                        raise FileNotFoundError("synthetic eviction/fetch failure")
            return ctx.store.get(target, path, max_bytes=max_bytes)

    lost = reads.candidate_finance(db, **query, store=FreshReadStore(Flaky(), limit=0))
    assert lost["accounts"] == [] and lost["reports"] == []
    assert lost["version"] != good["version"]
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(
            db, **query, store=FreshReadStore(Flaky(), limit=0), version=good["version"]
        )
    assert error.value.status_code == 409


def test_unknown_local_version_is_inspectable_but_cannot_claim_effective(
    db, local_generation
):
    ctx = local_generation
    publish(db, ctx)
    data = reads.candidate_finance(
        db,
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    report = data["reports"][0]
    assert report["effective"] is None
    assert (
        report["version_scope"] == "exact_document"
        and report["amendment_status"] == "not_established"
    )
    assert data["accounts"][0]["issued_id"] is False
    bad = deepcopy(ctx.g)
    bad["reports"][0]["effective"] = True
    bad["id"] = s.generation_digest(bad)
    with pytest.raises(ComparisonImportError, match="does not establish"):
        s.stage_generation(db, ctx.store, bad, ctx.originals)
