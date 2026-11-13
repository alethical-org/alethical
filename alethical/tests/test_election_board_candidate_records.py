"""Board candidate records stay separate from financial-account confirmation."""

# ruff: noqa: F811

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path
from threading import Event
import os

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from alethical.db import models as m
from alethical.pipeline import election_board_candidate_records as b
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import archive_source, digest
from alethical.pipeline.election_account_reviews import candidate_identity
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_source_provenance import engine, session  # noqa: F401
from alethical.tests.test_election_local_financial_form import native_pdf


import copy
import hashlib
import json

import pytest

from alethical.pipeline.election_comparison import ComparisonImportError


def captured(body=b'{"data":[]}', method="POST"):
    from urllib.parse import urlencode

    form = {
        "id": "2790",
        "year": "2026",
        "year_data[ElectionSegmentStartDate]": "2025",
        "year_data[ElectionSegmentEndDate]": "2026",
        "tabname": "reports_data",
    }
    url = "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api"
    encoded = urlencode(form)
    return {
        "method": method,
        "requested_url": url,
        "response_url": url,
        "status": 200,
        "body_complete": True,
        "body_sha256": hashlib.sha256(body).hexdigest(),
        "retained_body_bytes": len(body),
        "capture_outcome": "successful_200_capture",
        "charged_dispatches": 1,
        "dispatch_status": "dispatched_or_possible",
        "error_class": None,
        "javascript_executed": False,
        "started_at": "2026-11-13T21:00:00+00:00",
        "send_started_at": "2026-11-13T21:00:01+00:00",
        "response_received_at": "2026-11-13T21:00:02+00:00",
        "finished_at": "2026-11-13T21:00:03+00:00",
        "request_form": form,
        "response_headers": {"Content-Type": "application/json"},
        "prepared_request": {
            "method": method,
            "url": url,
            "form": form,
            "body_utf8": encoded,
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(encoded)),
                "Cookie": "PHPSESSID=",
            },
            "TLS_verify": True,
            "adapter_retry_total": 0,
            "allow_redirects": False,
            "ambient_credentials_disabled": True,
            "decoded_response_cap_bytes": 20000000,
            "timeout_connect_read_seconds": [10, 20],
        },
    }


def test_actual_post_profile_preserves_wire_form_and_times():
    from alethical.pipeline import election_board_candidate_records as b

    record = captured()
    receipt = b.prepare_post_acquisition(json.dumps(record).encode())
    assert receipt["requested"]["form"] == record["request_form"]
    assert receipt["requested"]["body_utf8"] == record["prepared_request"]["body_utf8"]
    assert receipt["final"]["copied_at"] == record["finished_at"]
    assert receipt["response_status"] == 200


@pytest.mark.parametrize(
    "change",
    ["partial", "form", "wire", "redirect", "retry", "status", "time", "boolean_size"],
)
def test_post_capture_refuses_changed_or_incomplete_evidence(change):
    from alethical.pipeline import election_board_candidate_records as b

    r = captured()
    if change == "partial":
        r["body_complete"] = False
    if change == "form":
        r["request_form"] = {**r["request_form"], "id": "1"}
    if change == "wire":
        r["prepared_request"]["body_utf8"] += "&id=1"
    if change == "redirect":
        r["prepared_request"]["allow_redirects"] = True
    if change == "retry":
        r["prepared_request"]["adapter_retry_total"] = 1
    if change == "status":
        r["status"] = 302
    if change == "time":
        r["finished_at"] = "2026-11-12T00:00:00+00:00"
    if change == "boolean_size":
        r["retained_body_bytes"] = True
    with pytest.raises(ComparisonImportError):
        b.prepare_post_acquisition(json.dumps(r).encode())


def test_section_versions_and_source_only_records_are_closed():
    from alethical.pipeline import election_board_candidate_records as b

    section = {
        "schema": b.SECTION_SCHEMA,
        "election_key": "mn-2026-11-03-general",
        "snapshot_id": "a" * 64,
        "records": [],
    }
    assert b.validate_section(section) == section
    for version in (None, True, 1, "future"):
        bad = {**section, "schema": version}
        with pytest.raises(ComparisonImportError):
            b.validate_section(bad)


# Shared test helpers are synthetic. They create checked decisions only inside
# the owned disposable database, never real candidate associations.


DEFINITION = b"""function viewPDF(year, type, period, se, regnum, amend) {
var theForm = $("#theForm")[0];
theForm.action = "https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF";
$("input[name='downloadpdf']").val("false");
$("input[name='year']").val(year);
$("input[name='type']").val(type);
$("input[name='period']").val(period);
$("input[name='se']").val(se);
$("input[name='regnum']").val(regnum);
$("input[name='amend']").val(amend);
submitToPopup(theForm);
}"""


def form_html():
    return (
        '<form id="theForm" method="post">'
        + "".join(
            f'<input type="hidden" name="{k}" value="{v}">'
            for k, v in {
                "searchType": "Candidate",
                "downloadpdf": "",
                "year": "",
                "type": "",
                "period": "",
                "se": "",
                "regnum": "",
                "amend": "",
                "disc": "",
                "date": "",
                "show": "0",
            }.items()
        )
        + "</form>"
    )


def fields(*, primary=False):
    values = [
        ("cover.title", b._TITLE, "text", "value"),
        ("cover.name", "Raymond David Petersen", "text", "value"),
        ("cover.office", "MN Senate District56", "text", "value"),
        ("cover.period_start", "2026-01-01", "date", "value"),
        (
            "cover.period_end",
            "2026-07-20" if primary else "2026-10-19",
            "date",
            "value",
        ),
        (
            "cover.received_date",
            "2026-07-21" if primary else "2026-10-20",
            "date",
            "value",
        ),
        (
            "cover.certification_date",
            "2026-07-22" if primary else "2026-10-20",
            "date",
            "value",
        ),
    ]
    for prefix in ("total", "nonitemized"):
        money = (
            {
                "cash": "201.18",
                "unpaid": "",
                "in_kind": "192.63 or 197.63" if prefix == "total" else "197.63",
                "total": "398.81",
            }
            if primary
            else (
                {
                    "cash": "1221.52",
                    "unpaid": "",
                    "in_kind": "291.00",
                    "total": "1512.52",
                }
                if prefix == "total"
                else {
                    "cash": "90.61",
                    "unpaid": "",
                    "in_kind": "291.00",
                    "total": "381.61",
                }
            )
        )
        for k, value in money.items():
            values.append(
                (
                    prefix + "." + k,
                    value,
                    "money",
                    "ambiguous" if " or " in value else "value" if value else "blank",
                )
            )
    if not primary:
        for n, amount in ((1, "197.18"), (2, "933.73")):
            row = {
                "date": "2026-06-24" if n == 1 else "2026-08-12",
                "payee": "VISTAPRINT" if n == 1 else '"',
                "street": "",
                "city": "Waltham" if n == 1 else "",
                "state": "MA" if n == 1 else "",
                "postal_code": "02451" if n == 1 else "",
                "purpose": "Printing of business cards"
                if n == 1
                else "Printing of lawn signs",
                "cash": amount,
                "unpaid": "",
                "in_kind": "",
                "total": amount,
            }
            for k, value in row.items():
                state = (
                    "ambiguous"
                    if k == "payee" and n == 2
                    else "redacted"
                    if k == "street" and n == 1
                    else "value"
                    if value
                    else "blank"
                )
                values.append(
                    (
                        f"item.{n}.{k}",
                        value,
                        "date"
                        if k == "date"
                        else "money"
                        if k in b._TOTALS
                        else "text",
                        state,
                    )
                )
    result = []
    for i, (key, value, kind, state) in enumerate(values):
        page = 1 if key.startswith("cover.") else 2
        row = int(key.split(".")[1]) if key.startswith("item.") else None
        result.append(
            r.field_proposal(
                key,
                page=page,
                bounds=[10, 10 + i * 20, 500, 27 + i * 20],
                label=key,
                literal=value,
                value_type=kind,
                state=state,
                currency="USD" if kind == "money" else None,
                record_type="disbursement" if row else "cover",
                row=row,
            )
        )
    return result


def make_capture(body, url, *, form=None, media="text/html"):
    from urllib.parse import urlencode

    record = captured(body)
    record.update(
        requested_url=url,
        response_url=url,
        method="GET" if form is None else "POST",
        response_headers={"Content-Type": media},
    )
    request = record["prepared_request"]
    request.update(url=url, method=record["method"])
    if form is None:
        record.pop("request_form")
        request.pop("form")
        request.pop("body_utf8")
        request["body"] = None
        request["headers"] = {"Cookie": "PHPSESSID="}
    else:
        record["request_form"] = form
        request["form"] = form
        request["body_utf8"] = urlencode(form)
        request["headers"]["Content-Length"] = str(len(request["body_utf8"]))
    evidence = json.dumps(record).encode()
    return b.prepare_post_acquisition(evidence), evidence


def world(
    engine, salt, *, offer_newer=False, catalogue_transform=None, mutate_viewer=None
):
    store = MemoryStore()
    rid = str(9000 + int(hashlib.sha256(salt.encode()).hexdigest()[:5], 16))
    source_url = f"{b.VIEWER_PREFIX}{rid}/2026/"
    definition_url = "https://cfb.mn.gov/cache/default." + "a" * 32 + ".js"
    html = (
        f'<script src="{definition_url}"></script><script>var candidate_tabs = new tab_content().init({{api:"/reports-and-data/viewers/campaign-finance/candidates/api",data_name:"candidtab",extra_data:{{id:"{rid}",year:"2026",year_data:{{"ElectionSegmentStartDate":2025,"ElectionSegmentEndDate":2026}}}}}});</script>'
        + "".join(
            f'<a data-candidtab="{tab}">{tab}</a>'
            for tab in ("information", "reports_data", "financial")
        )
    ).encode()
    if mutate_viewer is not None:
        html = mutate_viewer(html)
    info = json.dumps(
        {
            "data": [
                {
                    "RegisteredEntityID": rid,
                    "RegisteredEntityType": "AOC",
                    "CandidateFullName": "Petersen, Raymond",
                    "OfficeSought": "Senate",
                    "District": "56",
                    "ElectionYear": "2026",
                }
            ],
            "tabcontent": "Information",
        }
    ).encode()
    cat = json.dumps(
        {
            "data": {
                "pdfs": {
                    "report": {
                        "RegisteredEntityID": rid,
                        "RegisteredEntityType": "AOC",
                        "FilingYear": "2026",
                        "as_2DigitYear": "26",
                        "ReportType": "E",
                        "SpecialElectionindicator": "0",
                        "amendments": ["0"],
                        "CutOffDate": "2026-10-19 00:00:00",
                        "ReportName": "2026 Pre-General Report",
                    }
                },
                "notices": [],
                "disclosure": [],
                "notices_candidate": [],
            },
            "tabcontent": f"<a href=\"javascript:viewPDF('26','aoc','E','0','{rid}',0)\">PDF</a>"
            + form_html(),
        }
    ).encode()
    if offer_newer:
        payload = json.loads(cat)
        payload["data"]["pdfs"]["later"] = {
            **payload["data"]["pdfs"]["report"],
            "ReportType": "Y",
            "CutOffDate": "2026-12-31 00:00:00",
            "ReportName": "Year end",
        }
        payload["tabcontent"] += (
            f"<a href=\"javascript:viewPDF('26','aoc','Y','0','{rid}',0)\">Later PDF</a>"
        )
        cat = json.dumps(payload).encode()
    if catalogue_transform is not None:
        cat = catalogue_transform(cat)
    pdf = native_pdf({"name": "Raymond David Petersen " + salt}, second_page=True)
    sos = "99990401;Raymond David Petersen;9999;State Senator District 56;88;03;R\n".encode()
    bodies = {
        "viewer": html,
        "information": info,
        "catalogue": cat,
        "definition": DEFINITION,
        "pdf": pdf,
        "sos": sos,
    }
    segment = {"ElectionSegmentStartDate": 2025, "ElectionSegmentEndDate": 2026}
    captures = {
        "viewer": make_capture(html, source_url),
        "definition": make_capture(
            DEFINITION, definition_url, media="application/javascript"
        ),
        "information": make_capture(
            info,
            b.API_URL,
            form=b._tab_form(rid, 2026, segment, "information"),
            media="application/json",
        ),
        "catalogue": make_capture(
            cat,
            b.API_URL,
            form=b._tab_form(rid, 2026, segment, "reports_data"),
            media="application/json",
        ),
        "pdf": make_capture(
            pdf,
            b.PDF_URL,
            form={
                "searchType": "Candidate",
                "downloadpdf": "false",
                "year": "26",
                "type": "aoc",
                "period": "E",
                "se": "0",
                "regnum": rid,
                "amend": "0",
                "disc": "",
                "date": "",
                "show": "0",
            },
            media="application/pdf",
        ),
    }
    record = {
        "url": "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt",
        "bytes": len(sos),
        "sha256": hashlib.sha256(sos).hexdigest(),
        "fetched_at": "2026-11-13T21:00:00+00:00",
        "content_type": "text/plain",
    }
    evidence = json.dumps([record]).encode()
    captures["sos"] = p.prepare_acquisition(evidence, "/0"), evidence
    refs = {
        k: {
            "source_sha256": hashlib.sha256(body).hexdigest(),
            "acquisition_receipt_id": digest(captures[k][0]),
        }
        for k, body in bodies.items()
    }
    snapshot_id, race_id = digest([salt, "snapshot"]), digest([salt, "race"])
    with session(engine) as db:
        for body in bodies.values():
            archive_source(db, store, body)
        db.add(
            m.ElectionComparisonSnapshot(
                id=snapshot_id,
                election_key="mn-2026-11-03-general",
                election_date=date(2026, 11, 3),
                stage="general",
                fetched_at=datetime(2026, 11, 13, tzinfo=UTC),
                sources=[{"sha256": refs["sos"]["source_sha256"]}],
                coverage={},
            )
        )
        db.flush()
        candidate = {
            "candidate_id": "99990401",
            "name": "Raymond David Petersen",
            "party": "R",
            "is_write_in_aggregate": False,
        }
        race = m.ElectionComparisonRace(
            snapshot_id=snapshot_id,
            id=race_id,
            label="Senate56",
            office_id="9999",
            jurisdiction="88",
            result_status="unofficial",
            payload={
                "election_id": "201",
                "office_name": "State Senator District 56",
                "district": "56",
                "candidate_source_sha256": refs["sos"]["source_sha256"],
                "candidates": [candidate],
            },
        )
        db.add(race)
        db.flush()
        identity = candidate_identity(race, candidate)
        decisions = {
            k: p.record_provenance(
                db,
                store,
                receipt=receipt,
                evidence_body=evidence,
                decision="checked",
                reviewed_by="synthetic",
                reason="synthetic source",
                expected_previous_id=None,
            )
            for k, (receipt, evidence) in captures.items()
        }
    context = {
        "kind": b.CONTEXT,
        "record_id": rid,
        "year": 2026,
        "role": "AOC",
        **{
            k: refs[k]
            for k in ("viewer", "information", "catalogue", "definition", "pdf")
        },
        "report_type": "E",
        "amendment": 0,
    }
    reading = r.prepare_receipt(
        pdf, fields=fields(), document_kind="financial_report", source_context=context
    )
    with session(engine) as db:
        checked = r.record_reading(
            db,
            store,
            receipt=reading,
            decision="checked",
            reviewed_by="synthetic",
            reason="synthetic cells, not actual review",
            expected_previous_id=None,
        )
        reading_id, reading_row = r.receipt_digest(reading), checked.id
    relation = {
        "schema": b.RELATIONSHIP,
        "claim": "same_person_as_election_candidate",
        "election_key": "mn-2026-11-03-general",
        "snapshot_id": snapshot_id,
        "race_id": race_id,
        "candidate_id": candidate["candidate_id"],
        "identity": identity,
        "record_id": rid,
        "year": 2026,
        "role": "AOC",
        "viewer": refs["viewer"],
        "information": refs["information"],
        "sos": {**refs["sos"], "row": 1, "literal": sos.decode().strip()},
        "cover_reading_ids": [reading_id],
    }
    with session(engine) as db:
        rel = b.record_relationship(
            db,
            store,
            receipt=relation,
            decision="checked",
            reviewed_by="synthetic",
            reason="synthetic same-person judgment",
            expected_previous_id=None,
        )
    section = {
        "schema": b.SECTION_SCHEMA,
        "election_key": relation["election_key"],
        "snapshot_id": snapshot_id,
        "records": [
            {
                "record_id": rid,
                "year": 2026,
                "role": "AOC",
                **{k: refs[k] for k in ("viewer", "information", "catalogue")},
                "financial": None,
                "relationship_receipt_id": rel.receipt_sha256,
                "reports": [
                    {"report_key": digest(context), "reading_receipt_id": reading_id}
                ],
            }
        ],
    }
    return {
        "store": store,
        "bodies": bodies,
        "captures": captures,
        "refs": refs,
        "reading": reading,
        "reading_id": reading_id,
        "reading_row": reading_row,
        "relation": relation,
        "relation_row": rel.id,
        "section": section,
        "decisions": decisions,
        "hashes": {v["source_sha256"] for v in refs.values()},
    }


def load(db, w, **kwargs):
    return b.load_verified_section(
        db, w["store"], w["section"], allowed_source_hashes=w["hashes"], **kwargs
    )


def test_board_record_replay_preserves_unknowns_and_exact_measures(engine):
    w = world(engine, "good")
    with session(engine) as db:
        proof = load(db, w, lock=True)
        record = proof.records[0]
        report = record["reports"][0]
        assert record["relationship"]["candidate_id"] == "99990401"
        assert report["measures"]["total"]["normalized"] == "1512.52"
        assert report["measures"]["unpaid"]["state"] == "blank"
        assert report["items"][0]["fields"]["state"]["normalized"] == "MA"
        assert report["items"][1]["fields"]["payee"]["normalized"] is None
        assert "reviewed_by" not in json.dumps(proof.records)
        assert db.scalar(select(m.ElectionCampaignAccountDecision.id)) is None
        assert load(db, w, lock=True).version == proof.version
        assert b.section_requirements(db, w["section"])["source_hashes"] == sorted(
            w["hashes"]
        )
        if os.environ.get("ALETHICAL_BOARD_CORE_SECTION_EXAMPLE"):
            Path(os.environ["ALETHICAL_BOARD_CORE_SECTION_EXAMPLE"]).write_text(
                json.dumps(
                    {
                        "scope": "Synthetic disposable fixture only",
                        "section": w["section"],
                        "version": proof.version,
                        "records": proof.records,
                    },
                    indent=2,
                )
                + "\n"
            )


def test_cover_withdrawal_invalidates_relationship_and_version(engine):
    w = world(engine, "withdraw")
    with session(engine) as db:
        before = load(db, w).version
    with session(engine) as db:
        r.record_reading(
            db,
            w["store"],
            receipt=w["reading"],
            decision="withdrawn",
            reviewed_by="synthetic",
            reason="withdraw",
            expected_previous_id=w["reading_row"],
        )
    with session(engine) as db:
        with pytest.raises(ComparisonImportError):
            load(db, w, lock=True)
    with session(engine) as db:
        after = load(db, w, partial=True)
        assert after.version != before
        assert after.records[0]["state"] == "unavailable"
        assert not any(after.proof_outcomes.values())


@pytest.mark.parametrize(
    "change", ["candidate", "role", "year", "snapshot", "sos", "cover", "source"]
)
def test_wrong_relationship_bindings_refuse(engine, change):
    w = world(engine, "bad-" + change)
    bad = copy.deepcopy(w["relation"])
    if change == "candidate":
        bad["candidate_id"] = "99990302"
    if change == "role":
        bad["role"] = "PCC"
    if change == "year":
        bad["year"] = 2025
    if change == "snapshot":
        bad["snapshot_id"] = "0" * 64
    if change == "sos":
        bad["sos"]["literal"] += "altered"
    if change == "cover":
        bad["cover_reading_ids"] = ["0" * 64]
    if change == "source":
        bad["information"]["source_sha256"] = "0" * 64
    with session(engine) as db, pytest.raises(ComparisonImportError):
        b.record_relationship(
            db,
            w["store"],
            receipt=bad,
            decision="checked",
            reviewed_by="synthetic",
            reason="bad",
            expected_previous_id=w["relation_row"],
        )


def test_relationship_subject_does_not_split_on_candidate_or_evidence():
    receipt = {
        "election_key": "mn-2026",
        "record_id": "2790",
        "year": 2026,
        "role": "AOC",
    }
    a = b.relationship_subject(receipt)
    assert (
        b.relationship_subject(
            {
                **receipt,
                "candidate_id": "other",
                "snapshot_id": "changed",
                "schema": "v2",
            }
        )
        == a
    )


def test_concurrent_relationship_corrections_have_one_successor(engine):
    w = world(engine, "cas")
    start = Event()

    def withdraw(n):
        start.wait(5)
        try:
            with session(engine) as db:
                return b.record_relationship(
                    db,
                    w["store"],
                    receipt=w["relation"],
                    decision="withdrawn",
                    reviewed_by="synthetic",
                    reason=str(n),
                    expected_previous_id=w["relation_row"],
                ).id
        except ComparisonImportError:
            return "stale"

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(withdraw, n) for n in range(2)]
        start.set()
        results = [f.result(timeout=15) for f in futures]
    assert sum(type(x) is int for x in results) == 1
    assert "stale" in results


def test_strict_publication_proof_holds_cover_head_until_commit(engine):
    w = world(engine, "publication")
    ready, entered, release, completed = Event(), Event(), Event(), Event()

    def publication():
        with session(engine) as db:
            load(db, w, lock=True)
            ready.set()
            assert entered.wait(5)
            assert not completed.wait(0.15)
            release.set()

    def withdrawal():
        assert ready.wait(5)
        with session(engine) as db:
            entered.set()
            r.record_reading(
                db,
                w["store"],
                receipt=w["reading"],
                decision="withdrawn",
                reviewed_by="synthetic",
                reason="concurrent",
                expected_previous_id=w["reading_row"],
            )
        completed.set()

    with ThreadPoolExecutor(2) as pool:
        a, c = pool.submit(publication), pool.submit(withdrawal)
        a.result(timeout=15)
        c.result(timeout=15)
    assert release.is_set() and completed.is_set()
    with session(engine) as db, pytest.raises(ComparisonImportError):
        load(db, w, lock=True)


def test_later_offered_unheld_report_does_not_default_to_older_period(engine):
    w = world(engine, "newer-unheld", offer_newer=True)
    with session(engine) as db:
        record = load(db, w).records[0]
        assert len(record["reports"]) == 1
        assert record["selected_report_key"] is None


def test_board_wrapped_date_retains_full_printed_year_only():
    assert (
        r.normalize_field("6/24\n2026", "date", "value", schema=b.READING_SCHEMA)
        == "2026-06-24"
    )
    assert (
        r.normalize_field("8/12\n2026", "date", "value", schema=b.READING_SCHEMA)
        == "2026-08-12"
    )
    for literal in (
        "6/24\n26",
        "6/24\n202",
        "6/24 2026",
        "6/24/\n2026",
        "2/30\n2026",
        "6/24\n2026\n",
    ):
        with pytest.raises(ComparisonImportError):
            r.normalize_field(literal, "date", "value", schema=b.READING_SCHEMA)
    with pytest.raises(ComparisonImportError):
        r.normalize_field("6/24\n2026", "date", "value")


def test_absent_address_components_are_not_fabricated_and_blank_rows_not_payments():
    observed = [
        f
        for f in fields()
        if not (
            f["field_id"].startswith("item.2.")
            and f["field_id"].rsplit(".", 1)[1]
            in {"street", "city", "state", "postal_code"}
        )
    ]
    # Whole blank row has one actual combined payee/address cell, not 5 copies.
    for key, kind in [
        ("date", "date"),
        ("payee", "text"),
        ("purpose", "text"),
        *((k, "money") for k in b._TOTALS),
    ]:
        observed.append(
            r.field_proposal(
                "item.3." + key,
                page=2,
                bounds=[1, 1, 2, 2],
                label=key,
                literal="",
                state="blank",
                value_type=kind,
                currency="USD" if kind == "money" else None,
                record_type="disbursement",
                row=3,
            )
        )
    values = b.extract_reading({"fields": observed, "original_sha256": "a" * 64})
    assert len(values["items"]) == 2
    assert values["items"][1]["fields"]["state"] is None
    assert values["items"][0]["fields"]["state"]["normalized"] == "MA"


def test_legacy_collection_omitted_and_none_are_sql_null(engine):
    with session(engine) as db:
        for n, extra in enumerate(({}, {"candidate_records": None})):
            row = m.ElectionFinanceCollection(
                id=digest(["legacy-null", n]),
                election_key="synthetic",
                copied_at=datetime.now(UTC),
                sources=[],
                coverage={},
                **extra,
            )
            db.add(row)
            db.flush()
            assert db.execute(
                text(
                    "SELECT candidate_records IS NULL FROM election_finance_collection WHERE id=:id"
                ),
                {"id": row.id},
            ).scalar_one()
        with (
            pytest.raises(IntegrityError, match="candidate_records_schema"),
            db.begin_nested(),
        ):
            db.execute(
                text(
                    "INSERT INTO election_finance_collection (id,election_key,copied_at,sources,coverage,candidate_records) VALUES (:id,'synthetic',now(),'[]','{}','null'::jsonb)"
                ),
                {"id": digest("json-null-refused")},
            )


def test_reading_cannot_reference_relationship_provenance(engine):
    w = world(engine, "cycle")
    bad = copy.deepcopy(w["reading"])
    bad["source_context"]["information"]["acquisition_receipt_id"] = digest(
        w["relation"]
    )
    with (
        session(engine) as db,
        pytest.raises(ComparisonImportError, match="acquisition"),
    ):
        r.record_reading(
            db,
            w["store"],
            receipt=bad,
            decision="checked",
            reviewed_by="synthetic",
            reason="cycle",
            expected_previous_id=w["reading_row"],
        )


def test_missing_source_is_partial_unavailable_and_withdrawal_still_works(engine):
    w = world(engine, "missing-source")
    with session(engine) as db:
        before = load(db, w).version
    key = next(
        k for k in w["store"].objects if w["refs"]["information"]["source_sha256"] in k
    )
    del w["store"].objects[key]
    with session(engine) as db:
        value = load(db, w, partial=True)
        assert value.version != before
        assert value.records[0]["state"] == "unavailable"
        withdrawn = b.record_relationship(
            db,
            w["store"],
            receipt=w["relation"],
            decision="withdrawn",
            reviewed_by="synthetic",
            reason="source lost",
            expected_previous_id=w["relation_row"],
        )
        assert withdrawn.previous_decision_id == w["relation_row"]


def test_waiting_publication_observes_committed_relationship_withdrawal(engine):
    w = world(engine, "waited-relationship")
    locked, release = Event(), Event()

    def writer():
        with session(engine) as db:
            p.lock_provenance(
                db, set(), exclusive=b.relationship_subject(w["relation"])
            )
            locked.set()
            assert release.wait(5)
            b.record_relationship(
                db,
                w["store"],
                receipt=w["relation"],
                decision="withdrawn",
                reviewed_by="synthetic",
                reason="withdraw before publisher",
                expected_previous_id=w["relation_row"],
            )

    def reader():
        assert locked.wait(5)
        with session(engine) as db:
            db.execute(text("SELECT 1"))
            release.set()
            with pytest.raises(ComparisonImportError):
                load(db, w, lock=True)

    with ThreadPoolExecutor(2) as pool:
        a, c = pool.submit(writer), pool.submit(reader)
        a.result(timeout=15)
        c.result(timeout=15)


RETAINED = Path(os.environ.get("ALETHICAL_RETAINED_BOARD_EVIDENCE", "/nonexistent"))


def retained_fields(inventory, source):
    """Map root's semantic physical inventory, preserving all literal/state/bounds."""
    mapping = {
        "cover.document_title": "cover.title",
        "cover.candidate_full_name": "cover.name",
        "cover.office_district": "cover.office",
        "cover.period_start": "cover.period_start",
        "cover.period_end": "cover.period_end",
        "cover.receipt_stamp_date": "cover.received_date",
        "cover.certification_date": "cover.certification_date",
    }
    result = []
    for field in inventory["fields"]:
        if field["source"] != source:
            continue
        semantic = field["semantic_id"]
        key, row = mapping.get(semantic), None
        if semantic.startswith("non_itemized."):
            key = semantic.replace("non_itemized.", "nonitemized.")
        if semantic.startswith("total_expenditures."):
            key = semantic.replace("total_expenditures.", "total.")
        if semantic.startswith("itemized."):
            _, number, part = semantic.split(".")
            target = {
                "date_display": "date",
                "payee_name": "payee",
                "payee_and_address": "payee",
                **{
                    k: k
                    for k in (
                        "street",
                        "city",
                        "state",
                        "postal_code",
                        "purpose",
                        *b._TOTALS,
                    )
                },
            }.get(part)
            if target:
                key, row = f"item.{number}.{target}", int(number)
        if key is None:
            continue
        kind = (
            "date"
            if key.endswith(".date")
            or key
            in {
                "cover.period_start",
                "cover.period_end",
                "cover.received_date",
                "cover.certification_date",
            }
            else field["value_type"]
        )
        result.append(
            r.field_proposal(
                key,
                page=field["physical_page"],
                bounds=field["bounds"],
                label=field["label"],
                literal=field["literal"],
                state=field["state"],
                value_type=kind,
                currency=field["currency"],
                record_type="disbursement" if row else "cover",
                row=row,
                schema=b.READING_SCHEMA,
            )
        )
    return result


@pytest.mark.skipif(
    not (
        RETAINED / "jeremy-petersen-visual-fields-20261113/FIELD-INVENTORY.json"
    ).is_file(),
    reason="retained Board originals and physical inventory not supplied",
)
def test_retained_four_aoc_sources_and_two_pdf_readings(engine):
    """Actual bytes, ephemeral test decisions only; no real identity association."""
    store, refs, captures, bodies = MemoryStore(), {}, {}, {}
    locations = {
        "definition": "v11-candidate-search-assets-preparation-20261113/run-1/asset-2",
        "pdf_E": "jeremy-petersen-aoc-pdfs-20261113/run-1/source-1",
        "pdf_C": "jeremy-petersen-aoc-pdfs-20261113/run-1/source-2",
        "financial": "jeremy-petersen-aoc-financial-20261113/run-1/source-1",
        "2912_viewer": "v11-affidavit-viewer-2026-preparation-20261113/run-1/source-1",
        "2912_information": "jeremy-toby-information-20261113/run-1/source-1",
        "2912_catalogue": "jeremy-toby-catalogue-20261113/run-1/source-1",
    }
    for index, rid in enumerate(("2790", "2896", "2867")):
        locations[rid + "_viewer"] = (
            f"jeremy-three-affidavit-year-viewers-20261113/run-1/source-{index + 1}"
        )
        locations[rid + "_information"] = (
            f"jeremy-three-affidavit-api-20261113/run-1/source-{index * 2 + 1}"
        )
        locations[rid + "_catalogue"] = (
            f"jeremy-three-affidavit-api-20261113/run-1/source-{index * 2 + 2}"
        )
    with session(engine) as db:
        for key, location in locations.items():
            folder = RETAINED / location
            body, evidence = (
                (folder / "response.body").read_bytes(),
                (folder / "receipt.json").read_bytes(),
            )
            proposal = b.prepare_post_acquisition(evidence)
            assert (
                hashlib.sha256(body).hexdigest() == proposal["final"]["source_sha256"]
            )
            archive_source(db, store, body)
            checked = p.record_provenance(
                db,
                store,
                receipt=proposal,
                evidence_body=evidence,
                decision="checked",
                reviewed_by="disposable test",
                reason="retained fixture replay; not admission",
                expected_previous_id=None,
            )
            refs[key] = {
                "source_sha256": hashlib.sha256(body).hexdigest(),
                "acquisition_receipt_id": checked.receipt_sha256,
            }
            captures[key], bodies[key] = proposal, body
    hashes = {ref["source_sha256"] for ref in refs.values()}
    inventory = json.loads(
        (
            RETAINED / "jeremy-petersen-visual-fields-20261113/FIELD-INVENTORY.json"
        ).read_text()
    )
    readings = {}
    for source, period in ((1, "E"), (2, "C")):
        context = {
            "kind": b.CONTEXT,
            "record_id": "2790",
            "year": 2026,
            "role": "AOC",
            **{
                key: refs["2790_" + key]
                for key in ("viewer", "information", "catalogue")
            },
            "definition": refs["definition"],
            "pdf": refs["pdf_" + period],
            "report_type": period,
            "amendment": 0,
        }
        receipt = r.prepare_receipt(
            bodies["pdf_" + period],
            fields=retained_fields(inventory, source),
            document_kind="financial_report",
            source_context=context,
        )
        canonical = {
            page["metadata"]["page"]: page["metadata"]
            for page in inventory["canonical_pages"]
            if page["source"] == source
        }
        for page in receipt["pages"]:
            assert all(page[k] == v for k, v in canonical[page["page"]].items())
        with session(engine) as db:
            r.record_reading(
                db,
                store,
                receipt=receipt,
                decision="checked",
                reviewed_by="disposable test",
                reason="root physical inventory fixture; not admission",
                expected_previous_id=None,
            )
        readings[period] = receipt
    with session(engine) as db:
        proof = p.load_verified_provenance(
            db,
            p.source_resolver_for(db, store),
            [digest(v) for v in captures.values()],
            allowed_source_hashes=hashes,
            lock=True,
        )
        observations = {}
        with p.source_resolver_for(db, store)(hashes) as originals:
            for rid in ("2790", "2912", "2896", "2867"):
                html, segment = b.viewer_config(
                    originals, refs[rid + "_viewer"], rid, 2026, proof
                )
                info = b.information(
                    originals,
                    refs[rid + "_information"],
                    rid,
                    2026,
                    segment,
                    html,
                    proof,
                )
                cat = b.catalogue(
                    originals, refs[rid + "_catalogue"], rid, 2026, segment, html, proof
                )
                observations[rid] = {"information": info, "catalogue": cat}
                assert cat["state"] == (
                    "reports_offered"
                    if rid == "2790"
                    else "no_report_information_returned"
                )
        checked = r.load_verified_reading_context(
            db,
            store,
            [digest(v) for v in readings.values()],
            allowed_source_hashes=hashes,
            lock=True,
        )
        values = {
            key: checked.local_values(digest(value)) for key, value in readings.items()
        }
        assert values["E"]["measures"]["total"]["normalized"] == "1512.52"
        assert (
            len(values["E"]["items"]) == 2
            and values["E"]["items"][1]["fields"]["state"] is None
        )
        assert values["E"]["items"][0]["fields"]["date"]["literal"] == "6/24\n2026"
        assert values["C"]["measures"]["in_kind"]["state"] == "ambiguous"
        assert (
            values["C"]["measures"]["total"]["normalized"] == "398.81"
            and values["C"]["items"] == []
        )
        assert values["C"]["received_date"]["normalized"] == "2026-07-21"
        assert values["C"]["certification_date"]["normalized"] == "2026-07-22"
        assert (
            db.scalar(
                select(m.ElectionSourceProvenanceDecision.id).where(
                    m.ElectionSourceProvenanceDecision.schema_id == b.RELATIONSHIP,
                    m.ElectionSourceProvenanceDecision.receipt["record_id"].astext.in_(
                        ["2790", "2912", "2896", "2867"]
                    ),
                )
            )
            is None
        )
        if os.environ.get("ALETHICAL_BOARD_CORE_EXAMPLE"):
            Path(os.environ["ALETHICAL_BOARD_CORE_EXAMPLE"]).write_text(
                json.dumps(
                    {
                        "scope": "Disposable source/reading replay only; no candidate relationship or admission",
                        "observations": observations,
                        "reports": values,
                        "reading_receipts": readings,
                        "source_hashes": sorted(hashes),
                    },
                    indent=2,
                )
                + "\n"
            )


@pytest.mark.parametrize(
    "change", ["amendment", "period", "office", "source_id", "role", "money"]
)
def test_board_reading_context_rejects_wrong_filing_or_arithmetic(engine, change):
    w = world(engine, "bad-reading-" + change)
    bad = copy.deepcopy(w["reading"])
    if change == "amendment":
        bad["source_context"]["amendment"] = 1
    if change == "source_id":
        bad["source_context"]["record_id"] = "1"
    if change == "role":
        bad["source_context"]["role"] = "PCC"
    key, literal = {
        "period": ("cover.period_end", "2026-10-18"),
        "office": ("cover.office", "MN HOUSE DISTRICT 56"),
        "money": ("item.1.cash", "197.19"),
    }.get(change, (None, None))
    if key:
        for field in bad["fields"]:
            if field["field_id"] == key:
                field["literal"] = literal
                field["normalized"] = r.normalize_field(
                    literal,
                    field["value_type"],
                    field["state"],
                    schema=b.READING_SCHEMA,
                )
        for page in bad["pages"]:
            page["transcript"] = "\n".join(
                f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
                for f in bad["fields"]
                if f["page"] == page["page"]
            )
    with session(engine) as db, pytest.raises(ComparisonImportError):
        r.record_reading(
            db,
            w["store"],
            receipt=bad,
            decision="checked",
            reviewed_by="synthetic",
            reason="wrong filing",
            expected_previous_id=w["reading_row"],
        )


def test_relationship_cannot_be_used_as_an_acquisition(engine):
    w = world(engine, "typed-proof")
    with session(engine) as db:
        proof = p.load_verified_provenance(
            db,
            p.source_resolver_for(db, w["store"]),
            [digest(w["relation"])],
            allowed_source_hashes=w["hashes"],
            store=w["store"],
            lock=True,
        )
        assert (
            proof.relationship(digest(w["relation"]))["record_id"]
            == w["relation"]["record_id"]
        )
        with pytest.raises(ComparisonImportError):
            proof.acquisition(digest(w["relation"]))
        with pytest.raises(ComparisonImportError):
            proof.relationship(w["refs"]["information"]["acquisition_receipt_id"])
        board_id = w["refs"]["information"]["acquisition_receipt_id"]
        with pytest.raises(ComparisonImportError):
            proof.acquisition(board_id)
        assert proof.board_acquisition(board_id)["schema"] == p.BOARD_CAPTURE
        with pytest.raises(ComparisonImportError):
            proof.board_acquisition(digest(w["relation"]))
        required = p.provenance_requirements(db, [digest(w["relation"])])
        assert w["refs"]["pdf"]["acquisition_receipt_id"] in required["receipt_ids"]
        assert w["refs"]["pdf"]["source_sha256"] in required["public_original_hashes"]


@pytest.mark.parametrize(
    "headers, name, value",
    [
        ("request", "cookie", "session=private"),
        ("request", "cOoKiE", "session=private"),
        ("request", "content-type", "application/json"),
        ("request", "authorization", "Bearer private"),
        ("response", "content-type", "text/html"),
    ],
)
def test_capture_refuses_casefold_header_conflicts(headers, name, value):
    record = captured()
    target = (
        record["prepared_request"]["headers"]
        if headers == "request"
        else record["response_headers"]
    )
    target[name] = value
    with pytest.raises(ComparisonImportError):
        b.prepare_post_acquisition(json.dumps(record).encode())


def test_capture_accepts_casefolded_unique_headers_and_exact_empty_cookie():
    record = captured()
    record["prepared_request"]["headers"] = {
        k.lower(): v for k, v in record["prepared_request"]["headers"].items()
    }
    record["response_headers"] = {
        k.lower(): v for k, v in record["response_headers"].items()
    }
    assert (
        b.prepare_post_acquisition(json.dumps(record).encode())["final"]["media_type"]
        == "application/json"
    )


@pytest.mark.parametrize(
    "variant",
    [
        "comment",
        "string",
        "template",
        "nested",
        "assignment",
        "duplicate",
        "selector_space",
        "truncated",
        "string_comments",
    ],
)
def test_definition_requires_one_active_literal_mapping(engine, monkeypatch, variant):
    original = DEFINITION
    if variant == "comment":
        altered = (
            b"/*"
            + original
            + b"*/ function viewPDF(year,type,period,se,regnum,amend){if(true){regnum='123';}return null;}"
        )
    elif variant == "string":
        altered = b"var example=" + json.dumps(original.decode()).encode() + b";"
    elif variant == "template":
        altered = b"var example=`" + original + b"`;"
    elif variant == "nested":
        altered = b"if(false){" + original + b"}"
    elif variant == "assignment":
        altered = original + b";viewPDF=function(){return null;}"
    elif variant == "duplicate":
        altered = original + b"\n" + original
    elif variant == "selector_space":
        altered = original.replace(b"#theForm", b"#the Form")
    elif variant == "string_comments":
        altered = original.replace(b"#theForm", b"#theForm/*inert*/")
    else:
        altered = original[:-1]
    monkeypatch.setattr(
        __import__(__name__, fromlist=["DEFINITION"]), "DEFINITION", altered
    )
    with pytest.raises(ComparisonImportError):
        world(engine, "bad-definition-" + variant)


@pytest.mark.parametrize(
    "variant",
    [
        "commented_control",
        "extra_amendment",
        "same_cutoff",
        "template_control",
        "script_control",
        "event_control",
    ],
)
def test_catalogue_all_active_offers_must_agree(engine, variant):
    def transform(body):
        value = json.loads(body)
        if variant == "commented_control":
            value["tabcontent"] = "<!--" + value["tabcontent"].replace(
                "</a>", "</a>-->", 1
            )
        elif variant == "script_control":
            value["tabcontent"] += "<script>addAmendedReport();</script>"
        elif variant == "event_control":
            value["tabcontent"] += (
                '<span onclick="addAmendedReport()">Other report</span>'
            )
        elif variant == "template_control":
            value["tabcontent"] = "<template>" + value["tabcontent"].replace(
                "</a>", "</a></template>", 1
            )
        else:
            row = value["data"]["pdfs"]["report"]
            rid = row["RegisteredEntityID"]
            if variant == "same_cutoff":
                value["data"]["pdfs"]["competing"] = {**row, "ReportType": "Y"}
                control = f"viewPDF('26','aoc','Y','0','{rid}',0)"
            else:
                control = f"viewPDF('26','aoc','E','0','{rid}',1)"
            value["tabcontent"] += f'<a href="javascript:{control}">Other report</a>'
        return json.dumps(value).encode()

    with pytest.raises(ComparisonImportError):
        w = world(engine, "catalogue-" + variant, catalogue_transform=transform)
        with session(engine) as db:
            load(db, w, lock=True)


@pytest.mark.parametrize(
    "variant",
    [
        "commented_config",
        "commented_tab",
        "commented_script",
        "config_string",
        "nonexecutable_config",
    ],
)
def test_viewer_requires_active_config_and_controls(engine, variant):
    def transform(body):
        if variant == "commented_config":
            return body.replace(b"<script>var", b"<script>/*var", 1).replace(
                b");</script>", b");*/</script>", 1
            )
        if variant == "config_string":
            start = body.index(b"<script>var") + 8
            end = body.index(b"</script>", start)
            return (
                body[:start]
                + b"var example="
                + json.dumps(body[start:end].decode()).encode()
                + b";"
                + body[end:]
            )
        if variant == "nonexecutable_config":
            return body.replace(
                b"<script>var", b'<script type="application/json">var', 1
            )
        if variant == "commented_script":
            return b"<!--" + body.replace(b"</script>", b"</script>-->", 1)
        return body.replace(
            b'<a data-candidtab="reports_data">reports_data</a>',
            b'<!--<a data-candidtab="reports_data">reports_data</a>-->',
        )

    with pytest.raises(ComparisonImportError):
        world(engine, "viewer-" + variant, mutate_viewer=transform)


@pytest.mark.parametrize(
    "suffix",
    [
        b"window['view'+'PDF']=function(){return null;};",
        b"Object.assign(window,{['view'+'PDF']:function(){return null;}});",
        b"(function(){window['view'+'PDF']=function(){return null;};})();",
        b"function replaceMapping(){window['view'+'PDF']=function(){return null;};}replaceMapping();",
    ],
)
def test_definition_refuses_executed_top_level_mutation(engine, monkeypatch, suffix):
    monkeypatch.setattr(
        __import__(__name__, fromlist=["DEFINITION"]),
        "DEFINITION",
        DEFINITION + b"\n" + suffix,
    )
    with pytest.raises(ComparisonImportError):
        w = world(engine, "executed-mutation-" + hashlib.sha256(suffix).hexdigest()[:8])
        with session(engine) as db:
            load(db, w, lock=True)


def test_definition_comments_are_inert_without_altering_string_tokens():
    comments = "// inert viewPDF replacement text\n" * 10000
    assert b._pdf_function_tokens(
        comments + DEFINITION.decode()
    ) == b._pdf_function_tokens(DEFINITION.decode())
