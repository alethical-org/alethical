"""Finance's Media buys: originals and every check, never public-copy steps or links."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import json
import uuid
from urllib.parse import quote

import pytest

from alethical.api.services import finance_media_buys as media
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.pipeline import fcc_archive
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests import test_tv_ad_review as review_fixtures
from alethical.tests.finance_fixtures import (  # noqa: F401
    FINANCE_EMAIL,
    FINANCE_SUBJECT,
    finance_api,
    finance_db,
)
from alethical.tests.test_tv_ad_review import (
    ACTOR,
    approved,
    fact,
    pdf,
    preparation,
)
from alethical.tests.test_tv_ads import _register

BASE = "/api/v1/finance/media-buys"
FOLDER_URL = "https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files/folder-1"


@pytest.fixture(autouse=True)
def page_count(monkeypatch):
    # The page count otherwise reads the saved PDF from file storage.
    monkeypatch.setattr(reader, "original_page_count", lambda *args, **kwargs: 1)


@pytest.fixture()
def listed(finance_db):
    """Commit the listed account into the outer test transaction, so a refused
    request's rollback keeps it; the outer transaction still rolls back."""
    finance_db.commit()
    return finance_db


@pytest.fixture()
def source(listed):
    return review_fixtures.source.__wrapped__(listed)


def keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for item in value.values() for k in keys(item)}
    if isinstance(value, list):
        return {k for item in value for k in keys(item)}
    return set()


PUBLIC_COPY_KEYS = {
    "copy_id",
    "copy_status",
    "newest_approved_version",
    "files_with_approved_copy",
    "image_path",
}
ACCOUNT_KEYS = {
    "actor",
    "reviewed_by",
    "created_by",
    "metadata_reviewed_by",
    "email",
    "user_id",
}


def problems(value, path="data") -> list[str]:
    """Everything §5 and §7 forbid in a Finance answer: a link field, an
    alethical.com path, a public-copy field or an account identifier."""
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key.endswith("href") or key in PUBLIC_COPY_KEYS | ACCOUNT_KEYS:
                found.append(f"{path}.{key}")
            found += problems(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += problems(item, f"{path}[{index}]")
    elif isinstance(value, str) and (
        value.startswith(("/money/", "/admin/"))
        or any(who in value for who in (ACTOR, FINANCE_EMAIL, FINANCE_SUBJECT))
    ):
        found.append(f"{path} = {value!r}")
    return found


def _check(db, copy, field, value, **extra):
    """An unpublished check on an approved copy, written directly."""
    row = m.TVAdFact(
        publication_id=copy.id,
        field=field,
        value=value,
        page=1,
        quote=f"Synthetic {field} quote.",
        evidence="Synthetic check",
        reviewed_by=ACTOR,
        checked_at=review.now(),
        publication_approved=False,
        **extra,
    )
    db.add(row)
    db.flush()
    return row


def _connection(db, copy, kind, target_id, snapshot, **extra):
    """An unpublished checked connection, written directly; never a real check."""
    row = m.TVAdConnection(
        scope=extra.pop("scope", "file"),
        publication_id=copy.id if copy else None,
        facility_id="28010",
        folder_id="folder-1",
        kind=kind,
        target_id=target_id,
        target_snapshot=snapshot,
        page=extra.pop("page", 1),
        quote="Synthetic quote.",
        evidence="Synthetic connection",
        reviewed_by=ACTOR,
        checked_at=review.now(),
        publication_approved=False,
        **extra,
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture()
def held(listed, source):
    """1 original with machine-read text, an approved public copy carrying a
    different title, folder and category, an approved folder label, and only
    unpublished checks: everything Finance must read past or show."""
    db = listed
    document, store = source
    document.year = 2026
    document.folder_path = "political-files/2026/Federal/Sample Committee"
    db.add(
        m.FCCExtraction(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="readable",
            errors=[],
            facts=[{"field": "agency_name", "value": "Example Media", "page": 1}],
        )
    )
    db.flush()
    db.add(
        m.FCCPage(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text="Agency: Example Media. PRIVATE CONTACT NAME",
            status="readable",
            method="native",
        )
    )
    copy = approved(db, source)
    # A second file in the same folder, with its own approved copy, for a
    # related-document check.
    second = m.FCCDocument(
        facility_id="28010",
        file_id=str(uuid.uuid4()),
        content_hash=fcc_archive.archive_body(db, store, pdf() + b"\n% second"),
        call_sign="KSTP-TV",
        folder_id="folder-1",
        folder_path=document.folder_path,
        name="Second private title",
        url="https://files.fcc.gov/second.pdf",
        year=2026,
    )
    db.add(second)
    db.flush()
    prepared = review.prepare_copy(
        db,
        ACTOR,
        preparation((second, store), safe_title="Reviewed second"),
        store=store,
    )
    second_copy = review.approve_copy(
        db,
        prepared.id,
        ACTOR,
        {
            "expected_fingerprint": prepared.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
            "evidence": "Synthetic approval",
        },
        store=store,
    )
    # The folder's approved public label, which Finance never prints.
    listing = fcc_archive.archive_body(db, store, b"<html>Folder listing</html>")
    scan = m.FCCScan(status="complete", stations=["28010"], counts={})
    db.add(scan)
    db.flush()
    db.add(
        m.FCCObservation(
            scan_id=scan.id,
            url=FOLDER_URL,
            facility_id="28010",
            kind="folder",
            status="stored",
            content_hash=listing,
            details={"files": 2, "path": document.folder_path},
        )
    )
    db.flush()
    label = review.prepare_folder(
        db,
        ACTOR,
        {
            "facility_id": "28010",
            "folder_id": "folder-1",
            "content_hash": listing,
            "safe_label": "Reviewed folder label",
            "safe_path": "2026 / State / Reviewed folder label",
            "year": 2026,
            "category": "State",
            "evidence": "Synthetic metadata",
        },
    )
    review.approve_folder(
        db,
        label.id,
        ACTOR,
        {
            "expected_fingerprint": label.fingerprint,
            "metadata_reviewed": True,
            "evidence": "Synthetic",
        },
    )
    _register(db, "19002", "Example Lakes Committee", "House", "99A")
    _check(db, copy, "agency_name", "Example Media")
    _check(db, copy, "document_kind", "Invoice")
    _check(db, copy, "scheduled_airing", "October 1-7, 2026")
    _check(
        db,
        copy,
        "organization_address",
        "456 Example Avenue",
        organization_name="Example Media",
        role="Agency address",
        agency_address_reviewed=True,
    )
    _connection(
        db,
        copy,
        "committee",
        "19002",
        {"label": "Example Lakes Committee", "href": "/money/committees/19002"},
    )
    _connection(
        db,
        copy,
        "related_document",
        str(second_copy.id),
        {
            "label": "Reviewed second",
            "publication_id": str(second_copy.id),
            "facility_id": second.facility_id,
            "file_id": second.file_id,
            "content_hash": second.content_hash,
        },
    )
    _connection(
        db,
        copy,
        "expense",
        str(uuid.uuid4()),
        {
            "label": "Reported campaign expense",
            "source_row": {"amount": "100", "transaction_date": "2026-10-01"},
            "source_row_number": 7,
        },
    )
    _connection(db, copy, "issue", "Schools", {"label": "Schools"})
    _connection(
        db,
        None,
        "committee",
        "19002",
        {"label": "Example Lakes Committee", "href": "/money/committees/19002"},
        scope="folder",
        page=None,
        folder_content_hash=listing,
    )
    key = reader.file_key(document.facility_id, document.file_id)
    return {
        "document": document,
        "key": key,
        "second": reader.file_key(second.facility_id, second.file_id),
        "second_version": second.content_hash,
        "folder": reader.file_key("28010", "folder-1"),
    }


def test_a_file_opens_as_its_original_with_no_public_copy_fields(finance_api, source):
    document, _ = source
    key = reader.file_key(document.facility_id, document.file_id)
    response = finance_api.get(f"{BASE}/files/{key}")
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    detail = response.json()["data"]
    assert detail["name"] == "Private title"
    assert not keys(detail) & (PUBLIC_COPY_KEYS | {"href"})
    assert all("status" not in version for version in detail["versions"])
    assert detail["pages"][0]["image"] == (
        f"/finance/media-buys/files/{key}/pages/1?version={document.content_hash}"
    )


def test_every_check_shows_published_or_not_and_never_who_made_it(finance_db, source):
    document, _ = source
    copy = approved(finance_db, source)
    review.add_fact(finance_db, copy.id, ACTOR, fact())
    review.add_fact(
        finance_db,
        copy.id,
        ACTOR,
        fact(
            field="principal",
            value="Example Committee",
            quote="Principal: Example Committee.",
            publication_approved=False,
            privacy_reviewed=False,
        ),
    )
    key = reader.file_key(document.facility_id, document.file_id)
    detail = media.file_detail(finance_db, key)
    assert {f["value"] for f in detail["facts"]} == {
        "Example Media",
        "Example Committee",
    }
    public = reader.file_detail(finance_db, key, include_archive=True)
    assert {f["value"] for f in public["facts"]} == {"Example Media"}
    text = json.dumps(detail)
    assert ACTOR not in text and "Reviewed invoice" not in text


def test_a_correction_keeps_its_earlier_value_in_finance(finance_db, source):
    document, _ = source
    copy = approved(finance_db, source)
    old = review.add_fact(finance_db, copy.id, ACTOR, fact())
    review.add_fact(
        finance_db,
        copy.id,
        ACTOR,
        fact(supersedes_id=str(old.id), qualifier="Printed spelling"),
    )
    key = reader.file_key(document.facility_id, document.file_id)
    (current,) = [
        f for f in media.file_detail(finance_db, key)["facts"] if "value" in f
    ]
    assert [h["value"] for h in current["history"]] == ["Example Media"]
    # alethical.com prints an earlier value only after its own privacy approval.
    (public,) = [
        f
        for f in reader.file_detail(finance_db, key, include_archive=True)["facts"]
        if "value" in f
    ]
    assert public["history"] == []


def test_every_answer_carries_no_link_public_copy_field_or_account(finance_api, held):
    agency = reader.agency_key("Example Media")
    paths = [
        "/counts",
        "/sources",
        "/recent",
        "/browse",
        "/browse?tab=agencies",
        "/browse?tab=stations",
        "/browse?tab=years",
        "/browse?q=private contact",
        "/browse?q=Example",
        f"/files/{held['key']}",
        f"/files/{held['key']}?version={held['document'].content_hash}",
        f"/files/{held['second']}",
        f"/folders/{held['folder']}",
        f"/agencies/{agency}",
        "/stations/kstp-tv",
        "/connections?kind=committee&target=19002",
        "/connections?kind=name&target=" + quote("Example Media"),
    ]
    for path in paths:
        response = finance_api.get(BASE + path)
        assert response.status_code == 200, (path, response.text)
        data = response.json()["data"]
        assert problems(data) == [], path
        assert "Reviewed" not in json.dumps(data), path


def test_lists_and_search_describe_the_original_with_every_check(finance_api, held):
    def get(path):
        response = finance_api.get(BASE + path)
        assert response.status_code == 200, (path, response.text)
        return response.json()["data"]

    expected = {
        "name": "Private title",
        "folder_label": "Sample Committee",
        "category": "Federal",
        "kind": "Invoice",
        "airing_periods": ["October 1-7, 2026"],
    }

    def described(row):
        return {field: row.get(field) for field in expected}

    kstp = next(s for s in get("/recent")["stations"] if s["call_sign"] == "KSTP-TV")
    first = next(r for r in kstp["files"] if r["key"] == held["key"])
    assert described(first) == expected
    folder = get(f"/folders/{held['folder']}")
    assert (folder["label"], folder["category"]) == ("Sample Committee", "Federal")
    assert described(next(r for r in folder["files"] if r["key"] == held["key"])) == (
        expected
    )
    assert folder["relationship"]["target"] == {"kind": "committee", "id": "19002"}
    (row,) = get("/browse")["rows"]
    assert (row["label"], row["category"], row["file_count"]) == (
        "Sample Committee",
        "Federal",
        2,
    )
    (found,) = get("/browse?q=private contact")["rows"]
    assert (found["key"], found["match_label"]) == (
        held["key"],
        "Matched the file text, page 1",
    )
    (agency_row,) = get("/browse?tab=agencies")["rows"]
    assert (agency_row["label"], agency_row["unchecked"]) == ("Example Media", False)
    agency = get(f"/agencies/{agency_row['key']}")
    (group,) = agency["groups"]
    assert described(next(r for r in group["files"] if r["key"] == held["key"])) == (
        expected
    )
    assert [a["address"] for a in agency["addresses"]] == ["456 Example Avenue"]
    detail = get(f"/files/{held['key']}")
    assert described(detail) == expected
    assert detail["agencies"] == [
        {"key": agency_row["key"], "name": "Example Media", "unchecked": False}
    ]
    for kind, target in (("committee", "19002"), ("name", "Example Media")):
        files = get(f"/connections?kind={kind}&target={quote(target)}")["files"]
        assert [described(r) for r in files] == [expected], kind
    assert get("/counts")["checked_connection_files"] == 1
    assert get("/stations/kstp-tv")["counts"]["checked_connection_files"] == 1


def test_connections_carry_a_target_finance_can_open_or_none(finance_api, held):
    detail = finance_api.get(f"{BASE}/files/{held['key']}").json()["data"]
    by_kind = {c["kind"]: c for c in detail["connections"]}
    assert by_kind["committee"]["target"] == {"kind": "committee", "id": "19002"}
    related = by_kind["related_document"]
    # The exact version the check named, never the related file's newest.
    assert related["target"] == {
        "kind": "file",
        "id": held["second"],
        "version": held["second_version"],
    }
    assert related["label"] == "Second private title"
    # Nothing in Finance opens a reported expense row or printed issue text; the
    # expense's amount and source row stay on the connection.
    assert by_kind["expense"]["target"] is None
    assert by_kind["expense"]["reported_amount"] == "$100"
    assert by_kind["issue"]["target"] is None


def test_alethical_com_still_reads_only_approved_copies_and_published_checks(
    listed, held
):
    (kstp,) = [
        s
        for s in reader.recent(listed, include_archive=True)["stations"]
        if s["call_sign"] == "KSTP-TV"
    ]
    first = next(r for r in kstp["files"] if r["key"] == held["key"])
    assert (first["name"], first["kind"], first["airing_periods"]) == (
        "Reviewed invoice",
        None,
        [],
    )
    assert reader.connected(listed, "committee", "19002")["total"] == 0
    assert reader.counts(listed)["checked_connection_files"] == 0
    search = reader.browse(listed, q="private contact", include_archive=True)
    assert search["total"] == 0
    folder = reader.folder_detail(listed, held["folder"], include_archive=True)
    assert (folder["label"], folder["relationship"]) == ("Reviewed folder label", None)


def test_original_pages_are_served_private(finance_api, source, monkeypatch):
    document, _ = source
    calls = []
    monkeypatch.setattr(
        review,
        "render_original_page",
        lambda db, *args: calls.append(args) or b"\x89PNG",
    )
    key = reader.file_key(document.facility_id, document.file_id)
    response = finance_api.get(
        f"{BASE}/files/{key}/pages/1", params={"version": document.content_hash}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "no-store" in response.headers["cache-control"]
    assert calls == [(document.facility_id, document.file_id, document.content_hash, 1)]


def test_unknown_files_and_kinds_are_refused(finance_api, listed):
    assert finance_api.get(f"{BASE}/files/kstp-tv-missing").status_code == 404
    response = finance_api.get(f"{BASE}/connections?kind=bogus&target=x")
    assert response.status_code == 422, response.text


def test_media_buys_need_finance_access(client):
    assert client.get(f"{BASE}/counts").status_code == 401
