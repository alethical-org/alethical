"""Real PostgreSQL evidence decisions never infer a winner or alter result votes."""

# ruff: noqa: F811, F401
from copy import deepcopy
from datetime import date
import hashlib

import pytest
from sqlalchemy import select, update, delete
from sqlalchemy.exc import DBAPIError

from alethical.db import models as m
from alethical.pipeline import election_outcomes as outcomes
from alethical.pipeline import election_comparison as storage
from alethical.pipeline.election_account_reviews import candidate_identity
from alethical.tests.test_election_comparison_storage import (
    archive,
    db,
    prepared,
    source_set,
    changed_generation,
)

# Public dummy userinfo tests rejection before any publisher request.
_SYNTHETIC_CREDENTIAL_URL = "https://user:secret@www.sos.mn.gov/a"  # trufflehog:ignore


@pytest.fixture
def context(db, prepared, monkeypatch):
    store = archive(db, prepared)
    storage.stage_generation(db, prepared[0])
    snapshot = db.get(m.ElectionComparisonSnapshot, prepared[0]["id"])
    race = db.scalar(select(m.ElectionComparisonRace))
    candidate = next(
        c for c in race.payload["candidates"] if not c["is_write_in_aggregate"]
    )
    body = f"{race.label}\nFinal canvass certified\n{candidate['name']} elected\nA recount is pending\nTie remains unresolved\nCorrection withdraws earlier certification\n2026-11-03\n{race.jurisdiction}\n".encode()
    url = "https://www.sos.mn.gov/elections-voting/test-canvass"
    publisher_url = "https://www.sos.mn.gov/"
    publisher_body = f"Official publisher <a href='{url}'>Canvass</a>".encode()
    monkeypatch.setattr(
        outcomes,
        "_download",
        lambda link, hosts: (
            body if link == url else publisher_body,
            link,
            "text/plain" if link == url else "text/html",
        ),
    )
    capture = outcomes.capture_source(
        db,
        url=url,
        publisher_url=publisher_url,
        publisher_hosts=["www.sos.mn.gov"],
        authority="Minnesota canvassing board",
        store=store,
    )

    def locator(line):
        return {"line_start": line, "line_end": line, "encoding": "utf-8"}

    def evidence(kind, line=2, **extra):
        def binding(field, value, literal, number):
            return {
                "field": field,
                "value": value,
                "literal": literal,
                "quote": body.decode().splitlines()[number - 1],
                "locator": locator(number),
                "reason": "Private identity explanation",
            }

        bindings = [
            binding("office", race.label, race.label, 1),
            binding("election_date", "2026-11-03", "2026-11-03", 7),
            binding("jurisdiction", race.jurisdiction, race.jurisdiction, 8),
        ]
        if "candidate_id" in extra:
            bindings.append(
                binding("candidate_name", candidate["name"], candidate["name"], 3)
            )
        return dict(
            **outcomes.capture_metadata(capture),
            kind=kind,
            identity=outcomes.race_identity(snapshot, race),
            quote=body.decode().splitlines()[line - 1],
            locator=locator(line),
            context={"bindings": bindings},
            **extra,
        )

    request = dict(
        snapshot_id=snapshot.id,
        race_id=race.id,
        decision="recorded",
        result_status="certified",
        identity=outcomes.race_identity(snapshot, race),
        candidate_outcomes=[
            {
                "candidate_id": candidate["candidate_id"],
                "identity": candidate_identity(race, candidate),
                "outcome": "elected",
            }
        ],
        evidence=[
            evidence("race_status", status="certified"),
            evidence("final_certification", final=True),
            evidence(
                "candidate_outcome",
                3,
                candidate_id=candidate["candidate_id"],
                outcome="elected",
                final=True,
            ),
        ],
        reason="Private explanation",
        reviewed_by="Private reviewer",
        expected_previous_id=None,
    )
    monkeypatch.setattr(outcomes, "raw_file_store_from_env", lambda: store)
    return snapshot, race, candidate, store, request, evidence


def applicable(db, context):
    return outcomes.applicable_outcomes(db, snapshot_id=context[0].id)[context[1].id]


def test_no_review_never_declares_winner(db, context):
    result = applicable(db, context)
    assert result["result_status"] == "unofficial"
    assert all(
        c["outcome"] is None and c["outcome_status"] == "pending"
        for c in result["candidates"].values()
    )


def test_explicit_partial_certification_preserves_votes_and_other_candidates_pending(
    db, context
):
    _, race, candidate, _, request, _ = context
    original = deepcopy(race.payload)
    outcomes.record_decision(db, **request)
    result = applicable(db, context)
    assert result["candidates"][candidate["candidate_id"]]["outcome"] == "elected"
    assert race.payload == original
    for c in race.payload["candidates"]:
        if c["candidate_id"] != candidate["candidate_id"]:
            assert result["candidates"][c["candidate_id"]]["outcome"] is None
    assert "Private" not in str(result)
    assert result["outcome_review"]["evidence"][0]["url"].startswith("https://")


def test_repeat_stale_withdrawal_and_correction_history(db, context):
    *_, request, evidence = context
    first = outcomes.record_decision(db, **request)
    assert outcomes.record_decision(db, **deepcopy(request)).id == first.id
    stale = deepcopy(request)
    stale["reason"] = "different review"
    with pytest.raises(storage.ComparisonImportError, match="changed"):
        outcomes.record_decision(db, **stale)
    withdrawn = deepcopy(request)
    withdrawn.update(
        decision="withdrawn",
        result_status="pending",
        candidate_outcomes=[],
        expected_previous_id=first.id,
        evidence=[evidence("withdrawal", 6)],
    )
    second = outcomes.record_decision(db, **withdrawn)
    assert applicable(db, context)["outcome_review"]["state"] == "withdrawn"
    assert all(
        c["outcome"] is None for c in applicable(db, context)["candidates"].values()
    )
    assert outcomes.record_decision(db, **request).id == first.id
    assert applicable(db, context)["outcome_review"]["decision_id"] == second.id
    corrected = deepcopy(request)
    corrected["expected_previous_id"] = second.id
    third = outcomes.record_decision(db, **corrected)
    assert third.previous_decision_id == second.id
    assert len(outcomes.source_metadata(db, context[0].id)) == 2


@pytest.mark.parametrize(
    "status,line",
    [("recount", 4), ("tie", 5), ("pending", 4), ("unavailable", 4), ("unofficial", 4)],
)
def test_nonfinal_status_never_has_candidate_outcomes(db, context, status, line):
    *_, request, evidence = context
    request.update(
        result_status=status,
        candidate_outcomes=[],
        evidence=[evidence("race_status", line, status=status)],
    )
    outcomes.record_decision(db, **request)
    result = applicable(db, context)
    assert result["result_status"] == status
    assert all(c["outcome"] is None for c in result["candidates"].values())


@pytest.mark.parametrize(
    "change",
    [
        "quote",
        "hash",
        "identity",
        "candidate",
        "final",
        "context",
        "candidate_identity",
        "status",
    ],
)
def test_forged_wrong_source_and_incomplete_certification_rejected(db, context, change):
    *_, request, evidence = context
    if change == "quote":
        request["evidence"][0]["quote"] = "Invented certified statement"
    if change == "hash":
        request["evidence"][0]["sha256"] = "f" * 64
    if change == "identity":
        request["evidence"][0]["identity"]["jurisdiction"] = "wrong"
    if change == "candidate":
        request["candidate_outcomes"][0]["candidate_id"] = "unknown"
    if change == "candidate_identity":
        request["candidate_outcomes"][0]["identity"]["name"] = "wrong"
    if change == "final":
        request["evidence"][1]["final"] = False
    if change == "context":
        request["evidence"][0]["context"]["bindings"][2]["literal"] = "wrong city"
    if change == "status":
        request["evidence"][0]["status"] = "unofficial"
    with pytest.raises(storage.ComparisonImportError):
        outcomes.record_decision(db, **request)


def test_missing_corrupt_original_suppresses_claims_and_changes_version(db, context):
    _, _, _, store, request, _ = context
    outcomes.record_decision(db, **request)
    first = applicable(db, context)
    source = db.get(m.ElectionResultSource, request["evidence"][0]["sha256"])
    store.objects[source.object_key] = b"corrupt"
    failed = applicable(db, context)
    assert failed["outcome_review"]["state"] == "sources_unavailable"
    assert failed["outcome_review"]["version"] != first["outcome_review"]["version"]
    assert all(c["outcome"] is None for c in failed["candidates"].values())
    with pytest.raises(storage.ComparisonImportError, match="corrupt"):
        outcomes.record_decision(db, **request)


def test_new_snapshot_needs_its_own_review(db, context, prepared):
    outcomes.record_decision(db, **context[4])
    new_id = storage.stage_generation(db, changed_generation(prepared[0]))
    result = outcomes.applicable_outcomes(db, snapshot_id=new_id)[context[1].id]
    assert result["outcome_review"]["state"] == "unreviewed"
    assert all(c["outcome"] is None for c in result["candidates"].values())


def test_database_history_is_append_only(db, context):
    row = outcomes.record_decision(db, **context[4])
    for statement in (
        update(m.ElectionOutcomeDecision)
        .where(m.ElectionOutcomeDecision.id == row.id)
        .values(reason="changed"),
        delete(m.ElectionOutcomeDecision).where(m.ElectionOutcomeDecision.id == row.id),
    ):
        with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
            db.execute(statement)


def test_one_source_read_for_many_claims_and_histories(db, context, monkeypatch):
    outcomes.record_decision(db, **context[4])
    calls = []
    original = outcomes.read_source

    def read(store, source):
        calls.append(source.content_hash)
        return original(store, source)

    monkeypatch.setattr(outcomes, "read_source", read)
    applicable(db, context)
    assert len(calls) == 2


@pytest.mark.parametrize(
    "field,value",
    [
        ("url", "https://wrong.gov/source"),
        ("authority", "Different authority"),
        ("capture_id", "f" * 64),
        ("media_type", "text/html"),
        ("publisher_sha256", "e" * 64),
        ("final_url", "https://wrong.gov/final"),
    ],
)
def test_capture_provenance_cannot_be_relabelled(db, context, field, value):
    request = context[4]
    request["evidence"][0][field] = value
    with pytest.raises(storage.ComparisonImportError, match="capture"):
        outcomes.record_decision(db, **request)


def test_capture_only_is_repeat_safe_and_makes_no_outcome_claim(db, context):
    source = context[4]["evidence"][0]
    repeated = outcomes.capture_source(
        db,
        url=source["url"],
        publisher_url=source["publisher_url"],
        publisher_hosts=["www.sos.mn.gov"],
        authority=source["authority"],
        store=context[3],
    )
    assert repeated.id == source["capture_id"]
    assert applicable(db, context)["outcome_review"]["state"] == "unreviewed"


def test_captured_publisher_original_is_required_for_reads(db, context):
    outcomes.record_decision(db, **context[4])
    source = db.get(
        m.ElectionResultSource, context[4]["evidence"][0]["publisher_sha256"]
    )
    context[3].objects.pop(source.object_key)
    read = applicable(db, context)
    assert read["outcome_review"]["state"] == "sources_unavailable"
    assert all(c["outcome"] is None for c in read["candidates"].values())


def test_separate_literal_bindings_and_aliases_do_not_auto_promote_other_candidates(
    db, context
):
    request = context[4]
    # The source's literal word differs from the target office name. This is an
    # explicit, retained reviewer judgment, never an automatic name match.
    binding = request["evidence"][0]["context"]["bindings"][0]
    binding["literal"] = binding["literal"].split()[0]
    binding["reason"] = "Private explanation of source label shorthand"
    outcomes.record_decision(db, **request)
    read = applicable(db, context)
    assert read["result_status"] == "certified"
    assert sum(c["outcome"] is not None for c in read["candidates"].values()) == 1
    assert "Private" not in str(read)


def test_missing_jurisdiction_binding_rejects_generic_mayor_identity(db, context):
    request = context[4]
    request["evidence"][0]["context"]["bindings"] = [
        b
        for b in request["evidence"][0]["context"]["bindings"]
        if b["field"] != "jurisdiction"
    ]
    with pytest.raises(storage.ComparisonImportError, match="jurisdiction"):
        outcomes.record_decision(db, **request)


def test_zero_recount_totals_never_replace_original_votes(db, context):
    _, race, _, _, request, evidence = context
    original = deepcopy(race.payload)
    request.update(
        result_status="recount",
        candidate_outcomes=[],
        evidence=[evidence("race_status", 4, status="recount")],
    )
    outcomes.record_decision(db, **request)
    assert applicable(db, context)["result_status"] == "recount"
    assert race.payload == original
    assert all(
        c["outcome"] is None for c in applicable(db, context)["candidates"].values()
    )


def test_multiseat_partial_certification_does_not_fill_other_seats(db, context):
    race = context[1]
    race.payload = {**deepcopy(race.payload), "seats_to_elect": 3}
    outcomes.record_decision(db, **context[4])
    read = applicable(db, context)
    assert sum(c["outcome"] == "elected" for c in read["candidates"].values()) == 1
    assert all(c["outcome"] != "not_elected" for c in read["candidates"].values())


def test_source_capture_cannot_be_changed_or_deleted(db, context):
    source_id = context[4]["evidence"][0]["capture_id"]
    with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
        db.execute(
            update(m.ElectionOutcomeSource)
            .where(m.ElectionOutcomeSource.id == source_id)
            .values(authority="different publisher")
        )


@pytest.mark.parametrize(
    "url,addresses",
    [
        ("https://localhost/a", ["127.0.0.1"]),
        ("https://www.sos.mn.gov/a", ["10.1.1.1"]),
        ("https://www.sos.mn.gov/a", ["169.254.169.254"]),
        (_SYNTHETIC_CREDENTIAL_URL, ["8.8.8.8"]),
        ("http://www.sos.mn.gov/a", ["8.8.8.8"]),
        ("https://unapproved.gov/a", ["8.8.8.8"]),
    ],
)
def test_capture_blocks_private_hosts_credentials_and_unapproved_redirect_hosts(
    monkeypatch, url, addresses
):
    monkeypatch.setattr(
        outcomes.socket,
        "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", (ip, 443)) for ip in addresses],
    )
    with pytest.raises(storage.ComparisonImportError):
        outcomes._public_url(url, ["www.sos.mn.gov", "localhost"])


def test_synthetic_credentials_are_rejected_before_http_request(monkeypatch):
    class NoRequests:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def stream(self, *args, **kwargs):
            pytest.fail("Credential rejection must precede HTTP requests")

    monkeypatch.setattr(outcomes.httpx, "Client", lambda **kwargs: NoRequests())
    with pytest.raises(storage.ComparisonImportError):
        outcomes._download(_SYNTHETIC_CREDENTIAL_URL, ["www.sos.mn.gov"])


def test_pdf_page_quotes_use_actual_retained_pdf_text():
    from io import BytesIO
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=400)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 10 300 Td (Final canvass certified) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    body = BytesIO()
    writer.write(body)
    assert "Final canvass certified" in outcomes._quoted_text(
        body.getvalue(), "application/pdf", {"page": 1}
    )
    with pytest.raises(storage.ComparisonImportError, match="outside"):
        outcomes._quoted_text(body.getvalue(), "application/pdf", {"page": 2})


def test_capture_rejects_cross_host_document_without_retained_publisher_link(
    db, context, monkeypatch
):
    def unrelated(url, hosts):
        return b"Unrelated official page", url, "text/plain"

    monkeypatch.setattr(outcomes, "_download", unrelated)
    with pytest.raises(storage.ComparisonImportError, match="exact link"):
        outcomes.capture_source(
            db,
            url="https://files.official.gov/canvass.pdf",
            publisher_url="https://www.official.gov/",
            publisher_hosts=["files.official.gov", "www.official.gov"],
            authority="Explicit publisher",
            store=context[3],
        )


def test_capture_download_redirects_cannot_escape_approved_public_hosts(monkeypatch):
    from contextlib import contextmanager
    import httpx

    def check(url, hosts):
        assert outcomes.urlsplit(url).hostname in hosts

    monkeypatch.setattr(outcomes, "_public_url", check)

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["follow_redirects"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        @contextmanager
        def stream(self, method, url):
            yield httpx.Response(
                302,
                headers={"location": "https://unknown.gov/source"},
                request=httpx.Request(method, url),
            )

    monkeypatch.setattr(outcomes.httpx, "Client", Client)
    with pytest.raises(AssertionError):
        outcomes._download("https://official.gov/source", ["official.gov"])


def test_capture_download_has_redirect_limit(monkeypatch):
    from contextlib import contextmanager
    import httpx

    monkeypatch.setattr(outcomes, "_public_url", lambda *a: None)

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        @contextmanager
        def stream(self, method, url):
            yield httpx.Response(
                302, headers={"location": "/again"}, request=httpx.Request(method, url)
            )

    monkeypatch.setattr(outcomes.httpx, "Client", Client)
    with pytest.raises(storage.ComparisonImportError, match="redirect limit"):
        outcomes._download("https://official.gov/source", ["official.gov"])
