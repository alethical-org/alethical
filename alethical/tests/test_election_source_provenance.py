"""Reviewed acquisition provenance: pure replay plus disposable-Postgres history.

Synthetic receipts unless the private retained evidence folder is supplied (see
test_election_local_context). No network, real source decision or approval.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import hashlib
import json
import os
from pathlib import Path
import pickle
import subprocess
import sys
from threading import Event

import pytest
from sqlalchemy import create_engine, func, insert, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import election_local_context as c
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    archive_source,
    digest,
)
from alethical.pipeline.election_source_files import (
    SourceFileLimitError,
    verified_source_files,
)
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_source_files import Store, source

PAGE = "https://example.test/root"


def attempt(body=b"<html>synthetic</html>", *, media="text/html", url=PAGE):
    store = Store()
    metadata = source(store, body, media_type=media)
    record = {
        "requested_url": url,
        "fetched_at": "2026-11-12T00:00:00+00:00",
        "state": "captured",
        "redirects": [],
        "final_url": url,
        "sha256": metadata["content_hash"],
        "bytes": len(body),
    }
    if media is not None:
        record["content_type"] = media + "; charset=utf-8"
    return store, metadata, record


def capture(body=b"<html>synthetic</html>", *, media="text/html"):
    store, metadata, record = attempt(body, media=media)
    evidence = json.dumps(record).encode() + b"\n"
    return store, metadata, record, evidence, p.prepare_acquisition(evidence)


def empty_proof():
    return p._context({}, {}, {}, {}, set())


def test_capture_without_media_header_preserves_unknown():
    store, metadata, _, evidence, receipt = capture(media=None)
    assert receipt["final"]["media_type"] is None
    assert receipt["requested"]["method"] is None
    with verified_source_files(store, [metadata]) as originals:
        assert p.replay_acquisition(receipt, evidence, originals, empty_proof())


def test_media_type_is_the_literal_header_never_a_guess():
    _, _, _, _, receipt = capture()
    assert receipt["final"]["media_type"] == "text/html; charset=utf-8"


@pytest.mark.parametrize(
    "changed", ["hash", "size", "time", "url", "method", "selector", "header", "kind"]
)
def test_capture_rejects_claims_not_in_exact_private_record(changed):
    store, metadata, _, evidence, receipt = capture()
    if changed == "hash":
        receipt["evidence_sha256"] = "0" * 64
    elif changed == "size":
        receipt["final"]["byte_size"] += 1
    elif changed == "time":
        receipt["final"]["copied_at"] = "2025-01-01T00:00:00+00:00"
    elif changed == "url":
        receipt["final"]["url"] += "/other"
        receipt["requested"]["url"] += "/other"
    elif changed == "method":
        receipt["requested"]["method"] = "GET"
    elif changed == "selector":
        receipt["evidence_locator"]["pointer"] = "/absent"
    elif changed == "header":
        receipt["final"]["media_type"] = "application/pdf"
    else:
        receipt["capture_kind"] = "historical_collector_association"
    with (
        verified_source_files(store, [metadata]) as originals,
        pytest.raises(ComparisonImportError),
    ):
        p.replay_acquisition(receipt, evidence, originals, empty_proof())


@pytest.mark.parametrize(
    "body",
    [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b"[]", b'{"x":1', b"\xff"],
)
def test_private_evidence_is_strict_bounded_json(body):
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(body)


def test_oversized_evidence_is_refused():
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(b" " * (p.MAX_EVIDENCE + 1))


def test_historical_association_does_not_invent_redirect_status():
    store, metadata, record = attempt()
    start = "http://example.test/root"
    record["requested_url"] = start
    record["redirects"] = [{"from": start, "to": record["final_url"]}]
    body = json.dumps(record).encode()
    receipt = p.prepare_acquisition(body)
    assert receipt["capture_kind"] == "historical_collector_association"
    assert receipt["observed_hops"] == [{"from": start, "to": PAGE}]
    with verified_source_files(store, [metadata]) as originals:
        p.replay_acquisition(receipt, body, originals, empty_proof())
        stronger = copy.deepcopy(receipt)
        stronger["capture_kind"] = "response_hops"
        stronger["observed_hops"][0].update(
            method="GET",
            status=301,
            location=PAGE,
            observed_at="2026-11-12T00:00:00+00:00",
        )
        stronger["requested"]["method"] = "GET"
        with pytest.raises(ComparisonImportError):
            p.replay_acquisition(stronger, body, originals, empty_proof())
    record["redirects"][0]["http_status"] = 301
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(json.dumps(record).encode())


def hop_record(start, hops, *, body=None, media="text/html"):
    """Response-hop collector record; body is (url, sha256, bytes) or None."""
    record = {
        "request_id": "r",
        "method": "GET",
        "requested_url": start,
        "started_at": "2026-11-11T00:00:00+00:00",
        "finished_at": "2026-11-11T00:00:02+00:00",
        "response_hops": hops,
        "state": "captured" if body else "external_redirect_held",
    }
    if body:
        record.update(final_url=body[0], sha256=body[1], bytes=body[2])
    return record


def redirect(url, location, status=301, method="GET", at="2026-11-11T00:00:01+00:00"):
    return {
        "url": url,
        "method": method,
        "http_status": status,
        "headers": {"Location": location, "Content-Type": "text/html"},
        "at": at,
    }


def test_separately_captured_body_keeps_earlier_hop_and_later_copy_times():
    store, metadata, record = attempt(url=PAGE)
    body_evidence = json.dumps(record).encode()
    body_receipt = p.prepare_acquisition(body_evidence)
    h = digest(body_receipt)
    proof = p._context({h: body_receipt}, {}, {h: True}, {}, {metadata["content_hash"]})
    held = hop_record(
        "http://old.example/", [redirect("http://old.example/", PAGE, 308)]
    )
    evidence = json.dumps(held).encode()
    receipt = p.prepare_acquisition(evidence, body_capture=body_receipt)
    assert receipt["observed_hops"][0]["observed_at"] == "2026-11-11T00:00:01+00:00"
    assert receipt["final"]["copied_at"] == "2026-11-12T00:00:00+00:00"
    with verified_source_files(store, [metadata]) as originals:
        p.replay_acquisition(receipt, evidence, originals, proof)
        wrong = copy.deepcopy(receipt)
        wrong["final"]["copied_at"] = "2026-11-11T00:00:01+00:00"
        with pytest.raises(ComparisonImportError):
            p.replay_acquisition(wrong, evidence, originals, proof)
        with pytest.raises(ComparisonImportError):
            p.replay_acquisition(receipt, evidence, originals, empty_proof())
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(evidence)


def test_head_probe_never_proves_a_get_body():
    head = hop_record(
        PAGE,
        [
            {
                "url": PAGE,
                "method": "HEAD",
                "http_status": 200,
                "headers": {},
                "at": "2026-11-11T00:00:01+00:00",
            }
        ],
        body=(PAGE, "a" * 64, 10),
    )
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(json.dumps(head).encode())
    late = hop_record(
        PAGE,
        [
            redirect(PAGE, "/x", 302),
            {
                "url": PAGE + "/x",
                "method": "HEAD",
                "http_status": 200,
                "headers": {},
                "at": "2026-11-11T00:00:02+00:00",
            },
        ],
    )
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(json.dumps(late).encode())


def test_redirect_without_literal_location_is_refused():
    hop = redirect("http://old.example/", PAGE)
    del hop["headers"]["Location"]
    with pytest.raises(ComparisonImportError):
        p.prepare_acquisition(
            json.dumps(hop_record("http://old.example/", [hop])).encode()
        )


def test_runtime_proof_cannot_be_forged_copied_or_changed():
    proof = empty_proof()
    with pytest.raises(TypeError):
        proof.proof_outcomes["a" * 64] = True
    for action in (copy.copy, copy.deepcopy, pickle.dumps):
        with pytest.raises(TypeError):
            action(proof)
    forged = object.__new__(p.VerifiedProvenanceContext)
    with pytest.raises(ComparisonImportError):
        p.issued(forged)
    with pytest.raises(ComparisonImportError):
        p.VerifiedProvenanceContext({}, {}, {}, {}, set())
    store, metadata, _, evidence, receipt = capture()
    with verified_source_files(store, [metadata]) as originals:
        with pytest.raises(ComparisonImportError):
            p.replay_acquisition(receipt, evidence, originals, {"proof_outcomes": {}})
        with pytest.raises(ComparisonImportError):
            # Arbitrary labelled bytes are not a verified original.
            p.replay_acquisition(
                receipt, evidence, {metadata["content_hash"]: b"x"}, empty_proof()
            )


def test_root_receipt_rejects_unsigned_or_extra_fields():
    with pytest.raises(ComparisonImportError):
        p.validate_receipt({"schema": p.RECIPIENT, "accepted": True})
    with pytest.raises(ComparisonImportError):
        p.validate_receipt({"schema": "anything:v1"})


# --- Disposable PostgreSQL ------------------------------------------------------------

BOARD_URL = c.DIRECTORIES["mn_cfb_local_directory"]


@pytest.fixture(scope="module")
def engine():
    from scripts.local_checks import disposable_postgres

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
            yield engine
        finally:
            engine.dispose()


@contextmanager
def session(engine, isolation="READ COMMITTED"):
    with engine.connect().execution_options(isolation_level=isolation) as connection:
        with Session(connection) as db, db.begin():
            yield db


def directory_html(salt, county="Benton", href="http://portal.example/cf"):
    return (
        f'<html><head><base href="/"></head><body><!-- {salt} -->\n'
        '<div class="link-list col-md-3"><h2>City</h2><ul class="link-list">'
        '<li class="link-item"><a href="https://city.example/">Benton</a></li></ul></div>\n'
        '<div class="link-list col-md-3"><h2>County</h2><ul class="link-list">\n'
        f'<li class="link-item">\n<a href="{href}">{county}</a>\n</li></ul></div></body></html>'
    ).encode()


def world(engine, salt):
    """Retained synthetic directory, county table and reviewed-chain proposals."""
    store = MemoryStore()
    html = directory_html(salt)
    table = f"05;Benton;10\n# {salt}\n05;Benton;10\n".encode()
    other = f"<html>unrelated {salt}</html>".encode()
    with session(engine) as db:
        for body in (html, table, other):
            archive_source(db, store, body)
    route = {
        "name": "board",
        "url": BOARD_URL,
        "checked_at": "2026-11-11T20:52:08+00:00",
        "status": 200,
        "final_url": BOARD_URL,
        "bytes": len(html),
        "sha256": hashlib.sha256(html).hexdigest(),
        "hit_safety_byte_limit": False,
    }
    directory_evidence = json.dumps([route]).encode()
    directory = p.prepare_acquisition(directory_evidence, "/0")
    sos_record = {
        "url": "https://electionresultsfiles.sos.mn.gov/20261103/Cntytbl.txt",
        "bytes": len(table),
        "sha256": hashlib.sha256(table).hexdigest(),
        "fetched_at": "2026-11-11T15:17:43+00:00",
        "last_modified": "Mon, 02 Nov 2026 15:41:27 GMT",
        "content_type": "text/plain",
    }
    sos_evidence = json.dumps([sos_record]).encode()
    sos = p.prepare_acquisition(sos_evidence, "/0")
    doc = c._HTML(html)
    index, node = next(
        (i, n)
        for i, n in enumerate(doc.all("a"), 1)
        if n.attrs["href"] == "http://portal.example/cf"
    )
    root = {
        "schema": p.RECIPIENT,
        "original_routing_group": "mn-local:county:05",
        "election_date": "2026-11-03",
        "recipient": {
            "namespace": "county",
            "source_id": "05",
            "district_type": None,
            "municipality_type": None,
            "county_ids": ["05"],
        },
        "sos_rows": [
            {
                "source_sha256": hashlib.sha256(table).hexdigest(),
                "line": 1,
                "literal": "05;Benton;10",
                "kind": "county",
                "acquisition_receipt_id": digest(sos),
            }
        ],
        "directory": {
            "family": "mn_cfb_local_directory",
            "source_sha256": hashlib.sha256(html).hexdigest(),
            "source_url": BOARD_URL,
            "acquisition_receipt_id": digest(directory),
            "anchor_index": index,
            "line": node.line,
            "label": "Benton",
            "category": "County",
            "href": "http://portal.example/cf",
            "base_href": "/",
            "shared_target_entries": [],
        },
        "publisher_namespace": "benton-portal-" + salt,
        "entry_url": "http://portal.example/cf",
        "claim_scope": "official_publisher_for_typed_recipient",
    }
    other_record = {
        "requested_url": "https://other.example/" + salt,
        "fetched_at": "2026-11-12T00:00:00+00:00",
        "state": "captured",
        "redirects": [],
        "final_url": "https://other.example/" + salt,
        "sha256": hashlib.sha256(other).hexdigest(),
        "bytes": len(other),
    }
    other_evidence = json.dumps(other_record).encode() + b"\n"
    return {
        "store": store,
        "directory": (directory, directory_evidence),
        "sos": (sos, sos_evidence),
        "root": root,
        "other": (p.prepare_acquisition(other_evidence), other_evidence),
        "hashes": {hashlib.sha256(b).hexdigest() for b in (html, table, other)},
        "html": html,
    }


def record(
    engine,
    w,
    receipt,
    evidence=None,
    *,
    decision="checked",
    previous=None,
    reason="synthetic",
):
    with session(engine) as db:
        return p.record_provenance(
            db,
            w["store"],
            receipt=receipt,
            evidence_body=evidence,
            decision=decision,
            reviewed_by="synthetic reviewer",
            reason=reason,
            expected_previous_id=previous,
        )


def reviewed(engine, w):
    a = record(engine, w, *w["directory"])
    w["sos_row"] = record(engine, w, *w["sos"])
    r = record(engine, w, w["root"])
    o = record(engine, w, *w["other"])
    return a, r, o


def load(
    engine,
    w,
    ids,
    *,
    partial=False,
    lock=False,
    isolation="READ COMMITTED",
    resolver=None,
):
    with session(engine, isolation) as db:
        return p.load_verified_provenance(
            db,
            resolver or p.source_resolver_for(db, w["store"]),
            ids,
            allowed_source_hashes=w["hashes"],
            lock=lock,
            partial=partial,
        )


def test_checked_chain_proves_and_keeps_private_metadata_private(engine):
    w = world(engine, "private")
    a, r, o = reviewed(engine, w)
    proof = load(engine, w, [r.receipt_sha256, o.receipt_sha256], lock=True)
    assert dict(proof.proof_outcomes) == {
        a.receipt_sha256: True,
        w["sos_row"].receipt_sha256: True,
        r.receipt_sha256: True,
        o.receipt_sha256: True,
    }
    assert proof.recipient(r.receipt_sha256)["recipient"]["source_id"] == "05"
    assert not any(
        hasattr(proof, k) for k in ("evidence_body", "reviewed_by", "reason")
    )
    with session(engine) as db:
        needs = p.provenance_requirements(db, [r.receipt_sha256])
    public = json.dumps(needs)
    assert set(needs["receipt_ids"]) == {
        a.receipt_sha256,
        w["sos_row"].receipt_sha256,
        r.receipt_sha256,
    }
    assert set(needs["public_original_hashes"]) <= w["hashes"]
    for private in (
        "synthetic reviewer",
        "evidence_body",
        w["directory"][1].decode()[:40],
    ):
        assert private not in public


def test_idempotent_retry_reproves_before_returning(engine):
    w = world(engine, "retry")
    first = record(engine, w, *w["directory"])
    again = record(engine, w, *w["directory"])
    assert (again.id, again.created, first.created) == (first.id, False, True)
    key = next(
        k for k in w["store"].objects if hashlib.sha256(w["html"]).hexdigest() in k
    )
    lost = w["store"].objects.pop(key)
    with pytest.raises(Exception):
        record(engine, w, *w["directory"])
    w["store"].objects[key] = lost
    assert record(engine, w, *w["directory"]).id == first.id


def test_reviews_and_locked_proof_require_read_committed(engine):
    w = world(engine, "isolation")
    with pytest.raises(ComparisonImportError, match="READ COMMITTED"):
        with session(engine, "REPEATABLE READ") as db:
            p.record_provenance(
                db,
                w["store"],
                receipt=w["directory"][0],
                evidence_body=w["directory"][1],
                decision="checked",
                reviewed_by="x",
                reason="y",
                expected_previous_id=None,
            )
    a, r, _ = reviewed(engine, w)
    with pytest.raises(ComparisonImportError, match="READ COMMITTED"):
        load(engine, w, [r.receipt_sha256], lock=True, isolation="REPEATABLE READ")
    # Ordinary pinned reads may use a Repeatable Read snapshot.
    assert load(
        engine, w, [r.receipt_sha256], isolation="REPEATABLE READ"
    ).proof_outcomes[r.receipt_sha256]
    with pytest.raises(ComparisonImportError):
        load(engine, w, [r.receipt_sha256], lock=True, partial=True)


def test_withdrawal_invalidates_dependents_and_recovery_changes_the_pin(engine):
    w = world(engine, "withdraw")
    a, r, o = reviewed(engine, w)
    ids = [r.receipt_sha256, o.receipt_sha256]
    before = load(engine, w, ids).version
    withdrawn = record(
        engine, w, w["directory"][0], decision="withdrawn", previous=a.id
    )
    partial = load(engine, w, ids, partial=True)
    assert partial.proof_outcomes == {
        a.receipt_sha256: False,
        w["sos_row"].receipt_sha256: True,
        r.receipt_sha256: False,
        o.receipt_sha256: True,
    }
    assert partial.failure_reasons[r.receipt_sha256] == "dependency"
    with pytest.raises(ComparisonImportError):
        load(engine, w, ids)
    with pytest.raises(ComparisonImportError):
        record(
            engine, w, w["directory"][0], decision="withdrawn", previous=withdrawn.id
        )
    restored = record(
        engine, w, *w["directory"], previous=withdrawn.id, reason="restored"
    )
    after = load(engine, w, ids)
    assert all(after.proof_outcomes.values())
    assert len({before, partial.version, after.version}) == 3
    assert restored.previous_decision_id == withdrawn.id


def test_correction_replaces_the_head_and_stales_the_old_receipt(engine):
    w = world(engine, "correct")
    a, r, _ = reviewed(engine, w)
    before = load(engine, w, [r.receipt_sha256]).version
    # Same typed recipient subject, corrected to another exact official row.
    corrected = copy.deepcopy(w["root"])
    corrected["sos_rows"][0]["line"] = 3
    assert p.subject_key(corrected) == r.subject_key
    fabricated = copy.deepcopy(w["root"])
    fabricated["entry_url"] = "https://portal.example/cf"
    with pytest.raises(ComparisonImportError):
        record(engine, w, fabricated, previous=r.id)
    with pytest.raises(ComparisonImportError, match="changed"):
        record(engine, w, corrected, previous=None, reason="stale predecessor")
    fixed = record(engine, w, corrected, previous=r.id, reason="corrected row")
    stale = load(engine, w, [r.receipt_sha256], partial=True)
    assert stale.failure_reasons[r.receipt_sha256] == "not_current"
    with pytest.raises(ComparisonImportError):
        load(engine, w, [r.receipt_sha256])
    current = load(engine, w, [fixed.receipt_sha256])
    assert current.proof_outcomes[fixed.receipt_sha256] is True
    assert len({before, stale.version, current.version}) == 3
    # Withdrawal needs the exact current head; the superseded receipt cannot.
    with pytest.raises(ComparisonImportError):
        record(engine, w, w["root"], decision="withdrawn", previous=fixed.id)
    withdrawn = record(engine, w, corrected, decision="withdrawn", previous=fixed.id)
    assert (
        load(engine, w, [fixed.receipt_sha256], partial=True).failure_reasons[
            fixed.receipt_sha256
        ]
        == "not_current"
    )
    rechecked = record(engine, w, corrected, previous=withdrawn.id, reason="recheck")
    assert load(engine, w, [fixed.receipt_sha256]).proof_outcomes[fixed.receipt_sha256]
    assert rechecked.previous_decision_id == withdrawn.id


def test_source_loss_is_scoped_and_capacity_is_never_loss(engine):
    w = world(engine, "loss")
    a, r, o = reviewed(engine, w)
    key = next(
        k for k in w["store"].objects if hashlib.sha256(w["html"]).hexdigest() in k
    )
    lost = w["store"].objects.pop(key)
    partial = load(engine, w, [r.receipt_sha256, o.receipt_sha256], partial=True)
    assert partial.failure_reasons[a.receipt_sha256] == "source_unavailable"
    assert partial.proof_outcomes[o.receipt_sha256] is True
    with pytest.raises(ComparisonImportError):
        load(engine, w, [r.receipt_sha256])
    w["store"].objects[key] = lost
    assert load(engine, w, [r.receipt_sha256]).proof_outcomes[r.receipt_sha256]

    @contextmanager
    def busy(hashes):
        raise SourceFileLimitError("busy")
        yield

    for partial_read in (True, False):
        with pytest.raises(SourceFileLimitError):
            load(engine, w, [o.receipt_sha256], partial=partial_read, resolver=busy)


def _raw_insert(db, receipt, evidence, *, previous=None, decision="checked"):
    db.execute(
        insert(m.ElectionSourceProvenanceDecision).values(
            subject_key=p.subject_key(receipt),
            schema_id=receipt["schema"],
            receipt_sha256=digest(receipt),
            request_key=hashlib.sha256(
                json.dumps([digest(receipt), decision, previous]).encode()
            ).hexdigest(),
            previous_decision_id=previous,
            primary_source_sha256=p.primary_source(receipt),
            decision=decision,
            receipt=receipt,
            evidence_sha256=receipt.get("evidence_sha256"),
            evidence_body=evidence,
            reviewed_by="forged",
            reason="forged",
            reviewed_at=func.now(),
        )
    )


def test_cycles_corruption_and_missing_dependencies_fail_closed(engine, monkeypatch):
    w = world(engine, "forged")
    a, _, o = reviewed(engine, w)
    # Content addressing makes a stored hash cycle infeasible (each receipt would
    # contain the other's hash), so force a loop to exercise the guard itself.
    real = p.dependencies
    loop = {a.receipt_sha256: o.receipt_sha256, o.receipt_sha256: a.receipt_sha256}
    monkeypatch.setattr(
        p,
        "dependencies",
        lambda r: frozenset({loop[digest(r)]}) if digest(r) in loop else real(r),
    )
    partial = load(engine, w, [a.receipt_sha256], partial=True)
    assert partial.failure_reasons == {
        a.receipt_sha256: "cycle",
        o.receipt_sha256: "cycle",
    }
    with pytest.raises(ComparisonImportError, match="Cyclic"):
        load(engine, w, [a.receipt_sha256])
    monkeypatch.setattr(p, "dependencies", real)
    # Stored evidence whose bytes differ from its recorded hash is never trusted.
    altered = copy.deepcopy(w["directory"][0])
    altered["final"]["copied_at"] = "2026-11-11T20:52:09+00:00"
    with session(engine) as db:
        _raw_insert(db, altered, w["directory"][1] + b" ", previous=a.id)
    bad = digest(altered)
    assert load(engine, w, [bad], partial=True).failure_reasons[bad] == "invalid"
    with pytest.raises(ComparisonImportError):
        load(engine, w, [bad])
    missing = "f" * 64
    assert (
        load(engine, w, [missing], partial=True).failure_reasons[missing] == "missing"
    )
    root = copy.deepcopy(w["root"])
    root["directory"]["acquisition_receipt_id"] = missing
    with pytest.raises(ComparisonImportError):
        record(engine, w, root)
    with pytest.raises(ComparisonImportError):
        load(
            engine, w, [format(i, "064x") for i in range(p.MAX_NODES + 1)], partial=True
        )


def test_history_rows_are_append_only(engine):
    w = world(engine, "append")
    a = record(engine, w, *w["directory"])
    with pytest.raises(Exception):
        with session(engine) as db:
            db.execute(
                text(
                    "UPDATE election_source_provenance_decision SET reason='x' WHERE id=:i"
                ),
                {"i": a.id},
            )


def test_concurrent_reviewers_cannot_both_extend_one_head(engine):
    w = world(engine, "race")
    a = record(engine, w, *w["directory"])
    start = Event()

    def withdraw(reason):
        start.wait(5)
        try:
            return record(
                engine,
                w,
                w["directory"][0],
                decision="withdrawn",
                previous=a.id,
                reason=reason,
            ).id
        except Exception as exc:  # noqa: BLE001 - each loser reports its failure
            return type(exc).__name__

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(withdraw, f"reviewer {i}") for i in range(2)]
        start.set()
        results = [f.result(timeout=60) for f in futures]
    assert sum(isinstance(x, int) for x in results) == 1, results


def test_waiting_locked_reader_sees_a_committed_withdrawal(engine):
    """An advisory lock wait must end with fresh heads, never an old snapshot."""
    w = world(engine, "fresh")
    a, r, _ = reviewed(engine, w)
    locked, release = Event(), Event()

    def writer():
        with session(engine) as db:
            p.lock_provenance(db, set(), exclusive=a.subject_key)
            locked.set()
            release.wait(10)
            p.record_provenance(
                db,
                w["store"],
                receipt=w["directory"][0],
                evidence_body=None,
                decision="withdrawn",
                reviewed_by="x",
                reason="concurrent",
                expected_previous_id=a.id,
            )

    def reader():
        locked.wait(10)
        with session(engine) as db:
            db.execute(text("SELECT 1"))
            release.set()
            try:
                p.load_verified_provenance(
                    db,
                    p.source_resolver_for(db, w["store"]),
                    [r.receipt_sha256],
                    allowed_source_hashes=w["hashes"],
                    lock=True,
                )
            except ComparisonImportError as exc:
                return str(exc)
            return "proved"

    with ThreadPoolExecutor(2) as pool:
        wf, rf = pool.submit(writer), pool.submit(reader)
        wf.result(timeout=60)
        outcome = rf.result(timeout=60)
    assert (
        outcome
        == "Provenance proof failed: Provenance is not the current checked receipt"
        or "dependency" in outcome
    ), outcome


EVIDENCE = Path(os.environ.get("ALETHICAL_RETAINED_LOCAL_EVIDENCE", "/nonexistent"))


@pytest.mark.skipif(
    not (EVIDENCE / "local-source-capture" / "attempts.jsonl").is_file(),
    reason="private retained local evidence folder is not available",
)
def test_retained_examples_record_and_replay_through_postgres(engine):
    from alethical.tests import test_election_local_context as t

    acq = t.captures()
    roots = t.roots(acq)
    contexts = t.contexts(acq, roots)
    store = MemoryStore()
    hashes = set(t.ORIGINALS)
    with session(engine) as db:
        for h in sorted(hashes):
            archive_source(db, store, t.original(h))
    w = {"store": store, "hashes": hashes}
    order = sorted(acq, key=lambda n: acq[n][0]["body_capture_receipt_id"] is not None)
    for name in order:
        record(engine, w, *acq[name], reason="retained synthetic-scope test " + name)
    for name in roots:
        record(engine, w, roots[name], reason="retained synthetic-scope test " + name)
    for name, ctx in contexts.items():
        ids = t.c.context_dependencies(ctx)["provenance_receipt_ids"]
        with session(engine) as db:
            needs = p.provenance_requirements(db, ids)
            proof = p.load_verified_provenance(
                db,
                p.source_resolver_for(db, store),
                ids,
                allowed_source_hashes=set(needs["public_original_hashes"]),
                lock=True,
            )
        final = ctx["edges"][-1]["receipt_id"]
        pdf = proof.acquisition(final)["final"]["source_sha256"]
        public = set(t.c.context_dependencies(ctx)["public_original_hashes"]) | {pdf}
        with t.verified(public) as files:
            result = t.c.replay_local_context(
                ctx, t.synthetic_reading(pdf), originals=files, provenance=proof
            )
        assert result["report"]["amendment_status"] == "not_established"
        dumped = json.dumps(result)
        assert "Set-Cookie" not in dumped and "synthetic-scope test" not in dumped


# --- Official row origin (independent review defect 3) ------------------------------


def _sos_variant(engine, w, url_, *, body=None, salt="x"):
    """Record a manifest-row acquisition for exact retained bytes at ``url_``."""
    table = body if body is not None else _table_bytes(w)
    if body is not None:
        with session(engine) as db:
            archive_source(db, w["store"], body)
        w["hashes"].add(hashlib.sha256(body).hexdigest())
    evidence = json.dumps(
        [
            {
                "url": url_,
                "bytes": len(table),
                "sha256": hashlib.sha256(table).hexdigest(),
                "fetched_at": "2026-11-11T15:17:43+00:00",
                "content_type": "text/plain",
                "last_modified": "synthetic " + salt,
            }
        ]
    ).encode()
    receipt = p.prepare_acquisition(evidence, "/0")
    record(engine, w, receipt, evidence)
    return receipt


def _table_bytes(w):
    h = w["root"]["sos_rows"][0]["source_sha256"]
    key = next(k for k in w["store"].objects if h in k)
    import gzip

    return gzip.decompress(w["store"].objects[key])


@pytest.mark.parametrize(
    "variant",
    [
        "https://example.org/20261103/Cntytbl.txt",
        "https://electionresultsfiles.sos.mn.gov/20251103/Cntytbl.txt",
        "https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt",
        "http://electionresultsfiles.sos.mn.gov/20261103/Cntytbl.txt",
    ],
)
def test_official_row_needs_its_exact_reviewed_sos_endpoint(engine, variant):
    w = world(engine, "endpoint-" + hashlib.sha256(variant.encode()).hexdigest()[:12])
    record(engine, w, *w["directory"])
    other = _sos_variant(engine, w, variant)
    root = copy.deepcopy(w["root"])
    root["sos_rows"][0]["acquisition_receipt_id"] = digest(other)
    with pytest.raises(ComparisonImportError, match="reviewed official acquisition"):
        record(engine, w, root)


def test_reviewer_note_imitating_a_county_row_cannot_bind(engine):
    w = world(engine, "note")
    record(engine, w, *w["directory"])
    record(engine, w, *w["sos"])
    note = b"reviewer-made note, not a Secretary of State file\n\n05;Benton;10\n"
    with session(engine) as db:
        archive_source(db, w["store"], note)
    w["hashes"].add(hashlib.sha256(note).hexdigest())
    root = copy.deepcopy(w["root"])
    root["sos_rows"][0].update(source_sha256=hashlib.sha256(note).hexdigest(), line=3)
    # The real table's reviewed acquisition cannot stand for other bytes.
    with pytest.raises(ComparisonImportError, match="reviewed official acquisition"):
        record(engine, w, root)
    # A reviewed capture of the note itself is not an official endpoint either.
    fake = _sos_variant(
        engine, w, "https://notes.example/20261103/Cntytbl.txt", body=note
    )
    root["sos_rows"][0]["acquisition_receipt_id"] = digest(fake)
    with pytest.raises(ComparisonImportError, match="reviewed official acquisition"):
        record(engine, w, root)


def test_official_row_origin_is_in_the_closure_and_its_history_moves_the_pin(engine):
    w = world(engine, "rowhistory")
    a, r, o = reviewed(engine, w)
    sos = w["sos_row"]
    with session(engine) as db:
        needs = p.provenance_requirements(db, [r.receipt_sha256])
    assert sos.receipt_sha256 in needs["receipt_ids"]
    assert w["root"]["sos_rows"][0]["source_sha256"] in needs["public_original_hashes"]
    before = load(engine, w, [r.receipt_sha256]).version
    withdrawn = record(engine, w, w["sos"][0], decision="withdrawn", previous=sos.id)
    stale = load(engine, w, [r.receipt_sha256], partial=True)
    assert stale.failure_reasons[sos.receipt_sha256] == "not_current"
    assert stale.failure_reasons[r.receipt_sha256] == "dependency"
    with pytest.raises(ComparisonImportError):
        load(engine, w, [r.receipt_sha256], lock=True)
    record(engine, w, *w["sos"], previous=withdrawn.id, reason="restored row origin")
    after = load(engine, w, [r.receipt_sha256], lock=True)
    assert after.proof_outcomes[r.receipt_sha256] is True
    assert len({before, stale.version, after.version}) == 3


def test_manifest_record_keeps_unrecorded_facts_unknown(engine):
    w = world(engine, "manifest")
    sos = w["sos"][0]
    assert sos["capture_kind"] == "manifest_record"
    assert sos["requested"]["method"] is None
    assert sos["final"]["url"] is None and sos["final"]["wire_url"] is None
    assert sos["observed_hops"] == []
    forged = copy.deepcopy(sos)
    forged["final"]["url"] = sos["requested"]["url"]
    forged["final"]["wire_url"] = sos["requested"]["url"]
    with pytest.raises(ComparisonImportError):
        p.validate_receipt(forged)
    claimed = copy.deepcopy(sos)
    claimed["requested"]["method"] = "GET"
    with pytest.raises(ComparisonImportError):
        p.validate_receipt(claimed)
