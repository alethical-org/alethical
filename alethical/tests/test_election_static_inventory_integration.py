"""Normal receipt/stage/review lifecycle for non-issued static physical reports."""

# ruff: noqa: F811,F401
from copy import deepcopy
from datetime import date
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import urljoin

import pytest

from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_local_context as local
from alethical.pipeline import election_local_sources as adapter
from alethical.pipeline import election_source_provenance as provenance
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline import election_static_inventory as static
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    archive_source,
    digest,
)
from alethical.tests.test_election_local_reading_integration import (
    db,
    isolated_engine,
    local_generation,
)
from alethical.tests.test_election_local_financial_form import native_pdf
from alethical.tests.test_election_static_inventory import ITASCA, ITASCA_URL


@pytest.fixture
def static_generation(db, local_generation, request):
    options = getattr(request, "param", {})
    cover_name = options.get("cover_name", "Synthetic A. Candidate")
    cover_office = options.get("cover_office", "County Commissioner District 3")
    candidate_marked = options.get("candidate_marked", False)
    old = local_generation
    store = old.store
    originals, metadata = {}, {}
    copied = "2026-11-12T00:00:00+00:00"
    catalogue = (
        ITASCA.replace("Cassidy Villeneuve", "Synthetic Candidate")
        .replace("County Attorney", "County Commissioner District 3")
        .encode()
    )
    county = b"31;Itasca;62\n"
    county_url = "https://electionresultsfiles.sos.mn.gov/20261103/Cntytbl.txt"
    directory_url = local.DIRECTORIES["mn_cfb_local_directory"]
    directory = (
        '<div class="link-list"><h2>County</h2><ul class="link-list"><li class="link-item"><a href="'
        + ITASCA_URL
        + '">Itasca</a></li></ul></div>'
    ).encode()

    def capture(body, url, media, at=copied):
        h = hashlib.sha256(body).hexdigest()
        originals[h] = body
        archive_source(db, store, body)
        metadata[h] = {
            "sha256": h,
            "url": url,
            "media_type": media,
            "copied_at": at,
            "authority": None if url == county_url else "local:county:31",
        }
        evidence = json.dumps(
            {
                "requested_url": url,
                "final_url": url,
                "state": "captured",
                "redirects": [],
                "sha256": h,
                "bytes": len(body),
                "fetched_at": at,
                "content_type": media,
            }
        ).encode()
        return provenance.record_provenance(
            db,
            store,
            receipt=provenance.prepare_acquisition(evidence),
            evidence_body=evidence,
            decision="checked",
            reviewed_by="PRIVATE_TEST",
            reason="Synthetic static acquisition",
            expected_previous_id=None,
        )

    directory_row = capture(directory, directory_url, "text/html")
    county_row = capture(county, county_url, "text/plain")
    catalogue_row = capture(catalogue, ITASCA_URL, "text/html")
    catalogue_hash = hashlib.sha256(catalogue).hexdigest()
    root = {
        "schema": provenance.RECIPIENT,
        "original_routing_group": "mn-local:county:31",
        "election_date": "2026-11-03",
        "recipient": {
            "namespace": "county",
            "source_id": "31",
            "county_ids": ["31"],
            "district_type": None,
            "municipality_type": None,
        },
        "sos_rows": [
            {
                "source_sha256": hashlib.sha256(county).hexdigest(),
                "line": 1,
                "literal": county.decode().strip(),
                "kind": "county",
                "acquisition_receipt_id": county_row.receipt_sha256,
            }
        ],
        "directory": {
            "family": "mn_cfb_local_directory",
            "source_sha256": hashlib.sha256(directory).hexdigest(),
            "source_url": directory_url,
            "acquisition_receipt_id": directory_row.receipt_sha256,
            "anchor_index": 1,
            "line": 1,
            "label": "Itasca",
            "category": "County",
            "href": ITASCA_URL,
            "base_href": None,
            "shared_target_entries": [],
        },
        "publisher_namespace": "synthetic-itasca-static",
        "entry_url": ITASCA_URL,
        "claim_scope": "official_publisher_for_typed_recipient",
    }
    root_row = provenance.record_provenance(
        db,
        store,
        receipt=root,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Synthetic exact county root",
        expected_previous_id=None,
    )
    parsed = local._HTML(catalogue)
    documents = []
    for i, kind, start, end in [
        (1, "Initial", "05/19/26", "07/01/26"),
        (2, "Pre-primary", "07/02/26", "08/02/26"),
        (3, None, "08/02/26", "10/20/26"),
        (4, "certification", None, None),
    ]:
        certificate = i == 4
        changes = {
            "name": (201, 111, 9, cover_name),
            "office": cover_office,
            "period": (395, 184, 10, f"From {start} to {end}") if start else None,
            "candidate_mark": (30, 157, 10, "X Candidate")
            if candidate_marked and not certificate
            else None,
            "report_mark": (330, 155, 10, "X") if kind and not certificate else None,
            "report_type": (345, 155, 10, kind or "Pre-general"),
        }
        if certificate:
            changes.update(
                title="Certification of Filing",
                report_type=None,
                cert_statement=(
                    30,
                    210,
                    8,
                    "All required campaign financial reports have been submitted.",
                ),
                cert_choice=(30, 230, 10, "X"),
            )
        body = native_pdf(changes)
        a = parsed.all("a")[i - 1]
        url = urljoin(ITASCA_URL, a.attrs["href"])
        capture_row = capture(
            body,
            url,
            "application/pdf",
            at="2026-11-12T01:00:00+00:00" if certificate else copied,
        )
        specs = [
            (
                "name",
                "Name of candidate or committee",
                cover_name,
                "text",
                [197, 98, 585, 115],
            ),
            (
                "office",
                "Office sought by candidate (if applicable)"
                if certificate
                else "Office sought",
                cover_office,
                "text",
                [97, 121, 585, 137],
            ),
        ]
        if not certificate:
            specs += [
                (
                    "candidate_mark",
                    "Candidate",
                    "X" if candidate_marked else "",
                    "mark",
                    [20, 145, 45, 165],
                ),
                ("period_start", "From", start, "date", [420, 170, 480, 188]),
                ("period_end", "To", end, "date", [500, 170, 585, 188]),
                (
                    "report_type",
                    kind or "Pre-general",
                    "X" if kind else "",
                    "mark",
                    [320, 145, 340, 165],
                ),
            ]
        fields = [
            readings.field_proposal(
                "cover." + key,
                page=1,
                bounds=bounds,
                record_type="certification" if certificate else "cover",
                label=label,
                literal=literal,
                state="value" if literal else "blank",
                value_type=typ,
            )
            for key, label, literal, typ, bounds in specs
        ]
        if not certificate and options.get("financial_fields"):
            fields.append(
                readings.field_proposal(
                    "cover.disbursements",
                    page=1,
                    bounds=[480, 620, 580, 637],
                    record_type="cover",
                    label="Total disbursements",
                    literal="1101.75",
                    value_type="money",
                    currency="USD",
                )
            )
        if certificate:
            fields += [
                readings.field_proposal(
                    "certification.statement",
                    page=1,
                    bounds=[25, 195, 550, 215],
                    record_type="certification",
                    label="Certification",
                    literal="All required campaign financial reports have been submitted.",
                ),
                readings.field_proposal(
                    "certification.choice",
                    page=1,
                    bounds=[25, 215, 45, 235],
                    record_type="certification",
                    label="All required campaign financial reports have been submitted.",
                    literal="X",
                    value_type="mark",
                ),
            ]
        context = {
            "kind": local.CONTEXT_KIND,
            "root_receipt_id": root_row.receipt_sha256,
            "recipient_binding": None,
            "edges": [
                {"kind": "acquisition", "receipt_id": catalogue_row.receipt_sha256},
                {
                    "kind": "html_anchor",
                    "source_sha256": catalogue_hash,
                    "anchor_index": i,
                    "line": a.line,
                    "href": a.attrs["href"],
                    "label": local._text(a),
                    "base_href": None,
                    "target_url": url,
                },
                {"kind": "acquisition", "receipt_id": capture_row.receipt_sha256},
            ],
            "publisher_account": {
                "kind": local.PHYSICAL_SECTION,
                "namespace": "synthetic-itasca-static",
                "issued_id": False,
                **{
                    k: None
                    for k in (
                        "account_id",
                        "name_as_source",
                        "location",
                        "office",
                        "district",
                    )
                },
            },
            "document_role": "certification" if certificate else "primary",
            "fields": {
                "name": "cover.name",
                "office": "cover.office",
                "candidate_name": "cover.name"
                if candidate_marked and not certificate
                else None,
                "candidate_mark": None if certificate else "cover.candidate_mark",
                "period_start": None if certificate else "cover.period_start",
                "period_end": None if certificate else "cover.period_end",
                "report_type": []
                if certificate or kind is None
                else ["cover.report_type"],
            },
        }
        receipt = readings.prepare_receipt(
            body,
            fields=fields,
            document_kind="certification" if certificate else "financial_report",
            source_context=context,
            reading_scope={
                "cover": {"page": 1, "bounds": [0, 0, 612, 792]},
                "regions": [{"page": 1, "bounds": [0, 0, 612, 792], "role": "cover"}],
            },
        )
        row = readings.record_reading(
            db,
            store,
            receipt=receipt,
            decision="checked",
            reviewed_by="PRIVATE_TEST",
            reason="Synthetic checked visible section",
            expected_previous_id=None,
        )
        documents.append(
            SimpleNamespace(
                row=row,
                receipt=receipt,
                body=body,
                member_locator={
                    "anchors": [
                        {
                            "anchor_index": i,
                            "line": a.line,
                            "href": a.attrs["href"],
                            "label": local._text(a),
                        }
                    ]
                },
            )
        )
    proof = readings.load_verified_reading_context(
        db,
        store,
        [d.row.receipt_sha256 for d in documents],
        allowed_source_hashes=set(originals),
        election_date=date(2026, 11, 3),
    )

    def binding(index, kind, *, field_id=None):
        d = documents[index]
        locator = {"kind": kind, "receipt_sha256": d.row.receipt_sha256}
        if field_id is not None:
            locator["field_id"] = field_id
        if kind == "offered_inventory_version":
            locator.update(
                profile=static.STATIC_INVENTORY_PROFILE,
                members=sorted(
                    [
                        {
                            "member_locator": x.member_locator,
                            "receipt_sha256": x.row.receipt_sha256,
                        }
                        for x in documents
                    ],
                    key=lambda x: digest(x["member_locator"]),
                ),
            )
        if kind == "candidate_relationship":
            locator["relationship"] = "publisher_lists_report_for_person"
        info = metadata[d.receipt["original_sha256"]]
        result = adapter.extract_local_reading(d.body, info, locator, context=proof)
        return {
            "source_sha256": info["sha256"],
            "adapter": "local_checked_reading:v1",
            "locator": locator,
            "quote": result.quote,
            "facts": result.facts,
        }

    values = [proof.local_values(d.row.receipt_sha256) for d in documents]
    accounts = [
        v["account"] | {"status": "checked", "binding": binding(i, "account")}
        for i, v in enumerate(values)
    ]
    reports = [
        v["report"]
        | {
            "report_key": digest(
                ["static report", documents[i].receipt["original_sha256"]]
            ),
            "source_sha256": documents[i].receipt["original_sha256"],
            "check_status": "checked",
            "binding": binding(i, "report"),
            "version_binding": binding(i, "offered_inventory_version"),
            "figures": [],
        }
        for i, v in enumerate(values[:3])
    ]
    if options.get("financial_fields"):
        for i, report in enumerate(reports):
            figure = binding(i, "figure", field_id="cover.disbursements")
            report["figures"] = [
                {
                    k: v
                    for k, v in figure["facts"].items()
                    if k not in {"authority", "account_id", "source_report_id"}
                }
                | {"binding": figure}
            ]
    payload = {k: deepcopy(v) for k, v in old.g.items() if k != "id"}
    payload.update(
        sources=list({s["sha256"]: s for s in old.g["sources"]}.values())
        + list(metadata.values()),
        authorities=old.g["authorities"]
        + [
            values[0]["authority"]
            | {"status": "checked", "binding": binding(0, "authority")}
        ],
        accounts=accounts,
        reports=reports,
        payments=[],
    )
    generation = storage.prepare_generation(payload)
    return SimpleNamespace(
        g=generation,
        store=store,
        originals=old.originals | originals,
        documents=documents,
        values=values,
        proof=proof,
        binding=binding,
        reports=reports,
        base=old,
    )


@pytest.mark.parametrize("local_generation", [{"ballot_county": "31"}], indirect=True)
def test_normal_static_stage_publish_preserves_physical_accounts_and_only_checked_group(
    db, static_generation
):
    item = static_generation
    assert len({a["account_id"] for a in item.g["accounts"]}) == 4
    assert all(a["issued_id"] is False for a in item.g["accounts"])
    assert all(
        r["effective"] is None and r["source_report_id"] is None for r in item.reports
    )
    assert (
        len(
            {r["version_binding"]["facts"]["selection_group_key"] for r in item.reports}
        )
        == 1
    )
    assert item.reports[2]["report_type"] is None
    assert item.reports[1]["period_end"] == item.reports[2]["period_start"]
    storage.stage_generation(db, item.store, item.g, item.originals)
    storage.publish_generation(db, item.store, item.g["id"], expected_previous=None)
    assert len(storage.load_generation(db, item.g["id"])[1]["reports"]) == 3
    sources = item.reports[0]["version_binding"]["facts"]["version_sources"]
    certificate = item.documents[3]
    assert (
        next(
            x
            for x in sources
            if x["source_sha256"] == certificate.receipt["original_sha256"]
        )["source_copied_at"]
        == "2026-11-12T01:00:00+00:00"
    )
    with pytest.raises(ComparisonImportError):
        item.binding(3, "report")
    assert len(sources) == 5 and sources[-1]["source_copied_at"] in {
        "2026-11-12T00:00:00+00:00",
        "2026-11-12T01:00:00+00:00",
    }


def static_relationship_review_args(item, binding, index=2):
    d = item.documents[index]
    report = item.reports[index]
    args = deepcopy(item.base.args)
    args.update(
        registration_number=report["account_id"],
        authority=report["authority"],
        period_start=date.fromisoformat(report["period_start"]),
        period_end=date.fromisoformat(report["period_end"]),
    )
    evidence = [deepcopy(item.base.args["evidence"][0])]
    for kind, b in [
        ("authority", item.binding(index, "authority")),
        ("committee_register", item.binding(index, "account")),
        ("report_cover", item.binding(index, "report")),
        ("local_candidate_relationship", binding),
    ]:
        evidence.append(
            {
                "kind": kind,
                "sha256": b["source_sha256"],
                "generation_id": item.g["id"],
                "binding": b,
                **(
                    {"report_key": report["report_key"]}
                    if kind in {"report_cover", "local_candidate_relationship"}
                    else {}
                ),
                **(
                    {
                        "reason": "Official publisher explicitly lists this document for the exact ballot person"
                    }
                    if kind == "local_candidate_relationship"
                    else {}
                ),
            }
        )
    args["evidence"] = evidence
    assert storage.local_reading_ids(evidence) == {d.row.receipt_sha256}
    return args


@pytest.mark.parametrize("local_generation", [{"ballot_county": "31"}], indirect=True)
def test_normal_official_relationship_without_candidate_mark_has_no_companion_dependency(
    db, static_generation
):
    item = static_generation
    d = item.documents[2]
    binding = item.binding(2, "candidate_relationship")
    assert binding["facts"]["person_name"] == "Synthetic Candidate"
    assert binding["facts"]["account_name"] == "Synthetic A. Candidate"
    assert "Synthetic A. Candidate" in binding["quote"]
    assert storage.local_reading_ids(binding) == {d.row.receipt_sha256}
    storage.stage_generation(db, item.store, item.g, item.originals)
    report = item.reports[2]
    args = static_relationship_review_args(item, binding)
    reviews.record_decision(db, **args)
    # Withdrawing an unrelated certificate removes version proof but not this
    # exact source-backed person/account/period relationship.
    companion = item.documents[3]
    withdrawn = readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Synthetic withdrawal",
        expected_previous_id=companion.row.id,
    )
    proof = readings.load_verified_reading_context(
        db,
        item.store,
        [x.row.receipt_sha256 for x in item.documents],
        allowed_source_hashes=set(item.originals),
        partial=True,
    )
    info = next(
        s for s in item.g["sources"] if s["sha256"] == d.receipt["original_sha256"]
    )
    own = adapter.extract_local_reading(
        d.body,
        info,
        binding["locator"],
        context=proof,
    )
    assert own.facts == binding["facts"]
    with pytest.raises(ComparisonImportError):
        adapter.extract_local_reading(
            d.body,
            info,
            report["version_binding"]["locator"],
            context=proof,
        )

    readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Restore exact original checked certificate",
        expected_previous_id=withdrawn.id,
    )
    restored = readings.load_verified_reading_context(
        db,
        item.store,
        [x.row.receipt_sha256 for x in item.documents],
        allowed_source_hashes=set(item.originals),
    )
    effective = adapter.extract_local_reading(
        d.body, info, report["version_binding"]["locator"], context=restored
    )
    assert effective.facts == report["version_binding"]["facts"]
    assert effective.quote == report["version_binding"]["quote"]


@pytest.mark.parametrize("local_generation", [{"ballot_county": "31"}], indirect=True)
@pytest.mark.parametrize(
    "change", ["missing_companion", "wrong_locator", "group_key", "copy_time"]
)
def test_normal_static_stage_rejects_incomplete_or_forged_version(
    db, static_generation, change
):
    item = static_generation
    payload = deepcopy(item.g)
    payload.pop("id")
    binding = payload["reports"][0]["version_binding"]
    if change == "missing_companion":
        binding["locator"]["members"] = [
            m
            for m in binding["locator"]["members"]
            if m["receipt_sha256"] != item.documents[3].row.receipt_sha256
        ]
    elif change == "wrong_locator":
        binding["locator"]["members"][0]["member_locator"]["anchors"][0]["label"] += (
            " changed"
        )
        binding["locator"]["members"].sort(key=lambda m: digest(m["member_locator"]))
    elif change == "group_key":
        binding["facts"]["selection_group_key"] = "local-selection:" + "0" * 64
    else:
        catalogue_hash = binding["facts"]["version_sources"][0]["source_sha256"]
        next(s for s in payload["sources"] if s["sha256"] == catalogue_hash)[
            "copied_at"
        ] = "2026-11-13T00:00:00+00:00"
    with pytest.raises(ComparisonImportError):
        storage.stage_generation(
            db, item.store, storage.prepare_generation(payload), item.originals
        )


@pytest.mark.parametrize("local_generation", [{"ballot_county": "31"}], indirect=True)
@pytest.mark.parametrize(
    "static_generation",
    [
        {"candidate_marked": True, "cover_name": "Different Person"},
        {"cover_office": "County Sheriff"},
    ],
    indirect=True,
    ids=["checked_contrary_candidate", "checked_contrary_office"],
)
def test_reviewed_normal_contrary_identity_or_office_cannot_confirm(
    db, static_generation
):
    item = static_generation
    if item.g["accounts"][2]["candidate_name"] == "Different Person":
        with pytest.raises(ComparisonImportError):
            item.binding(2, "candidate_relationship")
        return
    binding = item.binding(2, "candidate_relationship")
    storage.stage_generation(db, item.store, item.g, item.originals)
    with pytest.raises(ComparisonImportError):
        reviews.record_decision(db, **static_relationship_review_args(item, binding))
