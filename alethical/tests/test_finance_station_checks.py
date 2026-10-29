"""Finance's own checks on original station files: the review's rules applied to
the original's own text, append-only rows keyed by exact version, every check in
Finance's reads, no trace of who made one, and alethical.com left untouched."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from alethical.api.auth import get_auth_service
from alethical.api.routers import tv_ads as admin_router
from alethical.api.services import finance_access
from alethical.api.services import finance_media_buys as media
from alethical.api.services import finance_station_checks as checks
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.api.services.finance_access import FinanceAccount
from alethical.db import models as m
from alethical.db.session import get_db, get_session_factory
from alethical.pipeline import fcc_archive
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.finance_fixtures import (  # noqa: F401
    FINANCE_EMAIL,
    finance_api,
    finance_db,
)
from alethical.tests.test_fcc_expense_links import _expense, _release
from alethical.tests.test_finance_media_buys import (  # noqa: F401
    BASE,
    held,
    listed,
    problems,
    source,
)
from alethical.tests.test_raw_file_mirror import MemoryStore
from alethical.tests.test_tv_ad_review import ACTOR, approved, fact, pdf

CLIENT = FinanceAccount("client-subject", "client@example.test", False)
TEAM = FinanceAccount("team-subject", "team@example.test", True)

PAGE_1 = (
    "Agency: Example Media. Gross amount: $1,250. "
    "Advertiser: Example Lakes Committee. Issue: Schools. "
    "Example Media, Agency address: 456 Example Avenue. PRIVATE CONTACT NAME"
)
PAGE_2 = (
    "Invoice date: 10/01/2026. Agent: Northern Buying Group. "
    "Paid for by Example River Committee."
)
# What no Finance answer may carry about a check: who made it, whether a team
# account did, or the private notes behind it.
CHECK_PRIVATE = {"made_by_alethical_team", "evidence", "withdrawal_reason"}


@pytest.fixture(autouse=True)
def page_count(monkeypatch):
    # The page count otherwise reads the saved PDF from file storage.
    monkeypatch.setattr(reader, "original_page_count", lambda *args, **kwargs: 1)


def _read(db, document, pages):
    """The original's machine-read text, page by page."""
    if db.get(m.FCCExtraction, (document.content_hash, EXTRACTOR_VERSION)) is None:
        db.add(
            m.FCCExtraction(
                content_hash=document.content_hash,
                version=EXTRACTOR_VERSION,
                document_kind="unknown",
                status="partial",
                errors=[],
                facts=[],
            )
        )
        db.flush()
    for number, words in pages.items():
        db.add(
            m.FCCPage(
                content_hash=document.content_hash,
                version=EXTRACTOR_VERSION,
                page=number,
                text=words,
                status="extracted",
                method="native",
            )
        )
    db.flush()


def _register(db, *committees):
    """Committees in 1 current registration snapshot."""
    filings = m.CampaignFinanceFilingSnapshot(
        fetch_started_at=review.now(),
        fetch_completed_at=review.now(),
        status=m.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(filings)
    db.flush()
    pointer = db.get(m.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer:
        pointer.snapshot_id = filings.id
    else:
        db.add(m.CampaignFinanceFilingCurrentSnapshot(id=True, snapshot_id=filings.id))
    for registration_number, name in committees:
        db.add(
            m.CampaignFinanceFiler(
                snapshot_id=filings.id,
                registration_number=registration_number,
                name=name,
                kind=m.CampaignFinanceFilerKind.candidate_committee,
            )
        )
    db.flush()


def _file(db, store, *, name="Another original", folder="folder-1", like=None):
    """Another held original, or with ``like`` a newer version of that file."""
    document = m.FCCDocument(
        facility_id="28010",
        file_id=like.file_id if like else str(uuid.uuid4()),
        content_hash=fcc_archive.archive_body(
            db, store, pdf() + b"\n% " + uuid.uuid4().hex.encode()
        ),
        call_sign="KSTP-TV",
        folder_id=like.folder_id if like else folder,
        folder_path=like.folder_path if like else f"political-files/2026/{folder}",
        name=like.name if like else name,
        url="https://files.fcc.gov/another.pdf",
        year=2026,
    )
    if like:
        document.last_downloaded_at = like.last_downloaded_at + timedelta(days=1)
    db.add(document)
    db.flush()
    return document


def _key(document):
    return reader.file_key(document.facility_id, document.file_id)


@pytest.fixture()
def original(listed, source):
    document, store = source
    document.year = 2026
    document.folder_path = "political-files/2026/Federal/Sample Committee"
    _read(listed, document, {1: PAGE_1, 2: PAGE_2})
    _register(
        listed,
        ("19002", "Example Lakes Committee"),
        ("19003", "Example River Committee"),
    )
    # Committed into the outer test transaction, so a refused request's
    # rollback keeps it; the outer transaction still rolls back.
    listed.commit()
    return SimpleNamespace(
        db=listed,
        document=document,
        store=store,
        key=_key(document),
        version=document.content_hash,
    )


def _fact(**changes):
    return {
        "field": "agency_name",
        "value": "Example Media",
        "page": 1,
        "quote": "Agency: Example Media.",
        "evidence": "Read on the original's page 1",
        "correctness_reviewed": True,
        **changes,
    }


def _connect(db, document, kind, target_id, *, quote, page=1, account=CLIENT, **data):
    """A connection made the way the Finance app makes one: preview, then save
    with the preview's fingerprint."""
    preview = checks.target_preview(
        db,
        _key(document),
        document.content_hash,
        kind,
        target_id,
        role=data.get("role"),
    )
    return checks.add_connection(
        db,
        account,
        _key(document),
        document.content_hash,
        {
            "kind": kind,
            "target_id": target_id,
            "page": page,
            "quote": quote,
            "evidence": "Read on the original",
            "correctness_reviewed": True,
            "expected_target_fingerprint": preview["target_fingerprint"],
            **data,
        },
    )


def _private_keys(value):
    if isinstance(value, dict):
        return (set(value) & CHECK_PRIVATE) | {
            k for item in value.values() for k in _private_keys(item)
        }
    if isinstance(value, list):
        return {k for item in value for k in _private_keys(item)}
    return set()


def test_a_fact_is_quoted_from_the_original_text_on_its_named_page(original):
    db, key, version = original.db, original.key, original.version
    row = checks.add_fact(db, CLIENT, key, version, _fact())
    assert (row.facility_id, row.file_id, row.content_hash, row.page) == (
        original.document.facility_id,
        original.document.file_id,
        version,
        1,
    )
    refused = {
        "machine-read text": [
            _fact(page=2),
            _fact(quote="Agency: Example Media Group."),
        ],
        "exact source page": [_fact(page=True), _fact(page="1")],
        "explicitly supported": [_fact(value="Other Media")],
        "explicitly printed": [
            _fact(field="gross_amount", value="1,300", quote="Gross amount: $1,250.")
        ],
        "Role must be printed": [_fact(role="Buyer")],
        "organizational role": [_fact(field="officer_name")],
        "exact printed organization": [
            _fact(
                field="organization_address",
                value="456 Example Avenue",
                role="Agency address",
                quote="Example Media, Agency address: 456 Example Avenue.",
            )
        ],
        "correctness review": [_fact(correctness_reviewed=False)],
        # Finance has no public pages: no publication or privacy approval.
        "their own fields": [
            _fact(publication_approved=True),
            _fact(privacy_reviewed=True),
        ],
        "Unsupported checked field": [_fact(field="mood")],
    }
    for message, attempts in refused.items():
        for data in attempts:
            with pytest.raises(ValueError, match=message):
                checks.add_fact(db, CLIENT, key, version, data)
    amount = checks.add_fact(
        db,
        CLIENT,
        key,
        version,
        _fact(field="gross_amount", value="$1,250", quote="Gross amount: $1,250."),
    )
    assert amount.value == "$1,250"
    with pytest.raises(LookupError):
        checks.add_fact(db, CLIENT, key, "b" * 64, _fact())


def test_an_agency_address_needs_finances_own_check_of_the_name_on_this_version(
    original,
):
    db, key, version = original.db, original.key, original.version
    address = _fact(
        field="organization_address",
        value="456 Example Avenue",
        role="Agency address",
        organization_name="Example Media",
        agency_address_reviewed=True,
        quote="Example Media, Agency address: 456 Example Avenue.",
    )
    with pytest.raises(ValueError, match="checked agency name on this version"):
        checks.add_fact(db, CLIENT, key, version, address)
    # A public copy's check of the name never stands in for Finance's own.
    copy = approved(db, (original.document, original.store))
    review.add_fact(db, copy.id, ACTOR, fact())
    with pytest.raises(ValueError, match="checked agency name on this version"):
        checks.add_fact(db, CLIENT, key, version, address)
    name = checks.add_fact(db, CLIENT, key, version, _fact())
    assert checks.add_fact(db, CLIENT, key, version, address).agency_address_reviewed
    checks.withdraw(db, m.FinanceTVFact, name.id, "Wrong agency")
    with pytest.raises(ValueError, match="checked agency name on this version"):
        checks.add_fact(db, CLIENT, key, version, address)


def test_connections_follow_the_review_rules_and_keep_no_alethical_address(original):
    db, key, version = original.db, original.key, original.version
    committee = _connect(
        db,
        original.document,
        "committee",
        "19002",
        quote="Advertiser: Example Lakes Committee.",
        role="Advertiser",
    )
    assert committee.target_snapshot["label"] == "Example Lakes Committee"
    assert "href" not in committee.target_snapshot
    with pytest.raises(ValueError, match="Role must be printed"):
        _connect(
            db,
            original.document,
            "committee",
            "19003",
            quote="Agency: Example Media.",
            role="Advertiser",
        )
    with pytest.raises(ValueError, match="current registration"):
        checks.target_preview(db, key, version, "committee", "99999")
    stale = checks.target_preview(db, key, version, "committee", "19003")
    with pytest.raises(ValueError, match="fingerprint"):
        checks.add_connection(
            db,
            CLIENT,
            key,
            version,
            {
                "kind": "committee",
                "target_id": "19002",
                "page": 1,
                "quote": "Agency: Example Media.",
                "evidence": "Read",
                "correctness_reviewed": True,
                "expected_target_fingerprint": stale["target_fingerprint"],
            },
        )
    assert (
        _connect(db, original.document, "issue", "Schools", quote="Issue: Schools.")
    ).target_snapshot == {"label": "Schools", "role": "Printed issue"}
    with pytest.raises(ValueError, match="exact printed text"):
        _connect(
            db, original.document, "issue", "www.example.com", quote="Issue: Schools."
        )
    other = _file(db, original.store)
    related = _connect(
        db,
        original.document,
        "related_document",
        f"{_key(other)}@{other.content_hash}",
        quote="Agency: Example Media.",
    )
    assert related.target_snapshot == {
        "label": "Another original",
        "facility_id": other.facility_id,
        "file_id": other.file_id,
        "content_hash": other.content_hash,
    }
    with pytest.raises(ValueError, match="another original version"):
        checks.target_preview(db, key, version, "related_document", f"{key}@{version}")
    with pytest.raises(ValueError, match="held original"):
        checks.target_preview(db, key, version, "related_document", f"{key}@{'c' * 64}")
    with pytest.raises(ValueError, match="Unsupported connection kind"):
        checks.target_preview(db, key, version, "folder", "folder-1")


def test_an_expense_connection_copies_the_exact_row_without_a_review_link(original):
    db, key, version = original.db, original.key, original.version
    snapshot = _release(db)["expenditures"]
    _expense(db, snapshot)
    db.add(
        m.CampaignFinanceSnapshotBody(
            snapshot_id=snapshot.id,
            object_key=f"synthetic/{snapshot.id}",
            compressed_hash="a" * 64,
            compressed_byte_size=100,
        )
    )
    db.flush()
    target = f"expenditures:{snapshot.id}:1"
    preview = checks.target_preview(db, key, version, "expense", target)
    assert preview["source_content_hash"] == snapshot.content_hash
    links = db.scalar(select(func.count()).select_from(m.FCCExpenseLink))
    data = {
        "kind": "expense",
        "target_id": target,
        "page": 1,
        "quote": "Gross amount: $1,250.",
        "evidence": "Same vendor and week",
        "correctness_reviewed": True,
        "expected_target_fingerprint": preview["target_fingerprint"],
        "source_content_hash": snapshot.content_hash,
        "file_identity_reviewed": True,
    }
    with pytest.raises(ValueError, match="file identity"):
        checks.add_connection(
            db, CLIENT, key, version, {**data, "file_identity_reviewed": False}
        )
    with pytest.raises(ValueError, match="expense copy fingerprint"):
        checks.add_connection(
            db, CLIENT, key, version, {**data, "source_content_hash": "b" * 64}
        )
    row = checks.add_connection(db, CLIENT, key, version, data)
    assert row.target_snapshot["source_row"]["amount"] == "17378.2500"
    # alethical.com's review links are its own; a Finance check writes none.
    assert db.scalar(select(func.count()).select_from(m.FCCExpenseLink)) == links

    def expense():
        (item,) = [
            c
            for c in media.file_detail(db, key)["connections"]
            if c["kind"] == "expense"
        ]
        return item

    assert (expense()["reported_amount"], expense()["source_changed"]) == (
        "$17,378",
        False,
    )
    _release(db)  # A newer published release replaces the row's copy.
    assert expense()["source_changed"] is True


def test_a_correction_is_a_new_row_and_a_withdrawal_is_set_once(original):
    db, key, version = original.db, original.key, original.version
    old = checks.add_fact(db, CLIENT, key, version, _fact())
    new = checks.add_fact(
        db,
        TEAM,
        key,
        version,
        _fact(supersedes_id=str(old.id), qualifier="Printed spelling"),
    )
    db.expire_all()
    assert (old.value, old.withdrawn_at, old.withdrawal_reason) == (
        "Example Media",
        None,
        None,
    )
    assert new.supersedes_id == old.id
    for again in (
        _fact(supersedes_id=str(old.id)),
        _fact(field="document_kind", value="Invoice", supersedes_id=str(new.id)),
    ):
        with pytest.raises(ValueError, match="standing check"):
            checks.add_fact(db, CLIENT, key, version, again)

    def facts():
        return media.file_detail(db, key)["facts"]

    (standing,) = [f for f in facts() if f["status"] == "checked"]
    assert [h["value"] for h in standing["history"]] == ["Example Media"]
    (corrected,) = [f for f in facts() if f["status"] == "withdrawn"]
    assert corrected["id"] == str(old.id) and "value" not in corrected
    # Withdrawing the corrected value removes it from its correction's history.
    checks.withdraw(db, m.FinanceTVFact, old.id, "Earlier value was a misreading")
    (standing,) = [f for f in facts() if f["status"] == "checked"]
    assert standing["history"] == []
    with pytest.raises(ValueError, match="already withdrawn"):
        checks.withdraw(db, m.FinanceTVFact, old.id, "Again")
    with pytest.raises(LookupError):
        checks.withdraw(db, m.FinanceTVFact, uuid.uuid4(), "Missing")
    # A public copy check withdraws only in Finance; its source row stays checked.
    copy = approved(db, (original.document, original.store))
    copy_fact = review.add_fact(db, copy.id, ACTOR, fact())
    checks.withdraw(db, m.FinanceTVFact, copy_fact.id, "Wrong value")
    assert copy_fact.status == "checked" and copy_fact.withdrawn_at is None
    # The database refuses every other change and every delete.
    for statement in (
        "UPDATE finance_tv_fact SET value = 'Changed'",
        "DELETE FROM finance_tv_fact",
    ):
        with pytest.raises(DBAPIError, match="Finance station-file check"):
            with db.begin_nested():
                db.execute(text(statement))
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(m.FinanceTVFact)) == 2
    assert db.get(m.FinanceTVFact, old.id).withdrawal_reason == (
        "Earlier value was a misreading"
    )


def test_each_check_records_the_team_flag_and_no_answer_shows_it(finance_api, original):
    db = original.db
    url = f"{BASE}/files/{original.key}/versions/{original.version}"
    first = finance_api.post(f"{url}/facts", json=_fact())
    assert first.status_code == 201, first.text
    finance_access.grant(db, FINANCE_EMAIL, team=True)
    second = finance_api.post(f"{url}/facts", json=_fact())
    assert second.status_code == 201, second.text
    team = finance_api.post(
        f"{url}/connections",
        json={
            "kind": "issue",
            "target_id": "Schools",
            "page": 1,
            "quote": "Issue: Schools.",
            "evidence": "Read",
            "correctness_reviewed": True,
            "expected_target_fingerprint": finance_api.get(
                f"{url}/target-preview",
                params={"kind": "issue", "target_id": "Schools"},
            ).json()["data"]["target_fingerprint"],
        },
    )
    assert team.status_code == 201, team.text
    ids = [response.json()["data"]["id"] for response in (first, second)]
    assert {
        str(row.id): row.made_by_alethical_team
        for row in db.scalars(select(m.FinanceTVFact))
    } == {ids[0]: False, ids[1]: True}
    assert db.get(
        m.FinanceTVConnection, uuid.UUID(team.json()["data"]["id"])
    ).made_by_alethical_team
    assert first.json()["data"] == {"id": ids[0], "status": "checked"}
    detail = finance_api.get(f"{BASE}/files/{original.key}").json()["data"]

    def same(item):
        return {k: v for k, v in item.items() if k not in {"id", "checked_at"}}

    client_fact, team_fact = (
        next(f for f in detail["facts"] if f["id"] == id_) for id_ in ids
    )
    assert same(client_fact) == same(team_fact)
    answers = [
        detail,
        first.json(),
        team.json(),
        finance_api.get(f"{BASE}/connections?kind=name&target=Example%20Media").json(),
        finance_api.get(f"{BASE}/browse?tab=agencies").json(),
    ]
    for answer in answers:
        assert _private_keys(answer) == set()
        assert problems(answer) == []
        assert "Read on the original" not in json.dumps(answer)


def test_finance_checks_join_copy_checks_on_the_file_page_lists_and_counts(
    finance_api, listed, held
):
    db = listed
    document = held["document"]
    facility, file_id = reader.identity(held["second"])
    second = db.get(m.FCCDocument, (facility, file_id, held["second_version"]))
    _read(db, document, {2: PAGE_2})
    _read(db, second, {1: "Paid for by Example River Committee."})
    _register(
        db,
        ("19002", "Example Lakes Committee"),
        ("19003", "Example River Committee"),
    )
    name = _fact(
        page=2, value="Northern Buying Group", quote="Agent: Northern Buying Group."
    )
    checks.add_fact(db, CLIENT, held["key"], document.content_hash, name)
    checks.add_fact(
        db,
        CLIENT,
        held["key"],
        document.content_hash,
        _fact(
            field="invoice_date",
            page=2,
            value="10/01/2026",
            quote="Invoice date: 10/01/2026.",
        ),
    )
    for file in (document, second):
        _connect(
            db,
            file,
            "committee",
            "19003",
            page=2 if file is document else 1,
            quote="Paid for by Example River Committee.",
        )

    def get(path):
        response = finance_api.get(BASE + path)
        assert response.status_code == 200, (path, response.text)
        data = response.json()["data"]
        assert problems(data) == [] and _private_keys(data) == set(), path
        return data

    detail = get(f"/files/{held['key']}")
    assert {"Example Media", "Northern Buying Group"} <= {
        f["value"] for f in detail["facts"]
    }
    assert {d["value"] for d in detail["dates"]} == {"October 1-7, 2026", "10/01/2026"}
    assert {
        c["target"]["id"] for c in detail["connections"] if c["kind"] == "committee"
    } == {"19002", "19003"}
    assert {a["name"]: a["unchecked"] for a in detail["agencies"]} == {
        "Example Media": False,
        "Northern Buying Group": False,
    }
    river = get("/connections?kind=committee&target=19003")
    assert {r["key"] for r in river["files"]} == {held["key"], held["second"]}
    named = get("/connections?kind=name&target=" + quote("Northern Buying Group"))
    assert [r["key"] for r in named["files"]] == [held["key"]]
    (agency,) = [
        r
        for r in get("/browse?tab=agencies")["rows"]
        if r["label"] == "Northern Buying Group"
    ]
    assert (agency["file_count"], agency["unchecked"]) == (1, False)
    ((row,),) = [g["files"] for g in get(f"/agencies/{agency['key']}")["groups"]]
    assert row["key"] == held["key"]
    assert get("/counts")["checked_connection_files"] == 2
    assert get("/stations/kstp-tv")["counts"]["checked_connection_files"] == 2


def test_a_check_on_an_older_version_stays_in_finance_lists_under_that_version(
    finance_api, original
):
    db, key, version = original.db, original.key, original.version
    checks.add_fact(
        db,
        CLIENT,
        key,
        version,
        _fact(
            page=2, value="Northern Buying Group", quote="Agent: Northern Buying Group."
        ),
    )
    _connect(
        db,
        original.document,
        "committee",
        "19002",
        quote="Advertiser: Example Lakes Committee.",
        role="Advertiser",
    )
    # The station files a newer version of the same file; checks never move to it.
    newer = _file(db, original.store, like=original.document)

    def get(path):
        response = finance_api.get(BASE + path)
        assert response.status_code == 200, (path, response.text)
        return response.json()["data"]

    for path in (
        "/connections?kind=committee&target=19002",
        "/connections?kind=name&target=" + quote("Northern Buying Group"),
    ):
        (row,) = get(path)["files"]
        assert (row["key"], row["version_id"], row["source_changed"]) == (
            key,
            version,
            True,
        ), path
    (agency,) = [
        r
        for r in get("/browse?tab=agencies")["rows"]
        if r["label"] == "Northern Buying Group"
    ]
    assert (agency["file_count"], agency["unchecked"]) == (1, False)
    ((row,),) = [g["files"] for g in get(f"/agencies/{agency['key']}")["groups"]]
    assert (row["version_id"], row["agency_unchecked"]) == (version, False)
    (found,) = get("/browse?q=Northern")["rows"]
    assert (found["version_id"], found["match_label"]) == (
        version,
        "Matched a checked fact",
    )
    assert get("/counts")["checked_connection_files"] == 1
    current = get(f"/files/{key}")
    assert (current["version_id"], current["facts"]) == (newer.content_hash, [])
    earlier = get(f"/files/{key}?version={version}")
    assert [f["value"] for f in earlier["facts"]] == ["Northern Buying Group"]


def test_a_related_document_opens_the_version_the_check_named(finance_api, original):
    db = original.db
    earlier = _file(db, original.store, name="Earlier order")
    _connect(
        db,
        original.document,
        "related_document",
        f"{_key(earlier)}@{earlier.content_hash}",
        quote="Agency: Example Media.",
    )
    _file(db, original.store, like=earlier)  # The related file is filed again.
    detail = finance_api.get(f"{BASE}/files/{original.key}").json()["data"]
    (related,) = [c for c in detail["connections"] if c["kind"] == "related_document"]
    assert related["target"] == {
        "kind": "file",
        "id": _key(earlier),
        "version": earlier.content_hash,
    }
    assert related["label"] == "Earlier order"


def test_withdrawing_a_public_copy_never_changes_a_finance_check(original):
    db, key, version = original.db, original.key, original.version
    copy = approved(db, (original.document, original.store))
    copied = review.add_fact(db, copy.id, ACTOR, fact())
    mine = checks.add_fact(db, CLIENT, key, version, _fact())
    other = _file(db, original.store)
    _read(db, other, {1: "Agency: Example Media."})
    pointing = _connect(
        db,
        other,
        "related_document",
        f"{key}@{version}",
        quote="Agency: Example Media.",
    )

    def finance_view():
        facts = media.file_detail(db, key)["facts"]
        (connection,) = media.file_detail(db, _key(other))["connections"]
        return [f for f in facts if f["id"] == str(mine.id)], connection

    before = finance_view()
    review.withdraw_copy(db, copy.id, ACTOR, "Synthetic privacy correction")
    assert finance_view() == before
    assert before[1]["id"] == str(pointing.id) and before[1]["status"] == "checked"
    (withdrawn,) = [
        f for f in media.file_detail(db, key)["facts"] if f["id"] == str(copied.id)
    ]
    assert withdrawn["status"] == "withdrawn"
    db.expire_all()
    assert db.get(m.FinanceTVFact, mine.id).withdrawn_at is None


def test_reads_fetch_only_the_checks_of_the_files_they_show(original, monkeypatch):
    db, key, version = original.db, original.key, original.version
    elsewhere = _file(db, original.store, folder="folder-2")
    _read(db, elsewhere, {1: PAGE_1})
    checks.add_fact(db, CLIENT, key, version, _fact())
    _connect(
        db,
        elsewhere,
        "committee",
        "19003",
        quote="Advertiser: Example Lakes Committee.",
    )
    loaded = []
    real = reader._original_checks

    def spy(db, files=None):
        loaded.append(real(db, files))
        return loaded[-1]

    monkeypatch.setattr(reader, "_original_checks", spy)

    def read(call):
        loaded.clear()
        call()
        return {v for result in loaded for kind in result.values() for v in kind}

    mine = (original.document.facility_id, original.document.file_id, version)
    theirs = (elsewhere.facility_id, elsewhere.file_id, elsewhere.content_hash)
    assert read(lambda: media.file_detail(db, key)) == {mine}
    assert read(lambda: media.file_detail(db, _key(elsewhere))) == {theirs}
    assert read(lambda: media.connected(db, "committee", "19003")) == {theirs}
    assert read(lambda: media.connected(db, "committee", "19002")) == set()


@pytest.fixture()
def admin(client, listed, monkeypatch):
    """alethical.com's administrator readers, on the same records."""
    monkeypatch.setattr(admin_router, "administrator_access", lambda *args: True)
    client.app.dependency_overrides[get_db] = lambda: listed
    client.app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(
        authenticate=lambda token: SimpleNamespace(
            provider_subject=ACTOR,
            provider="supabase",
            email="tv-api@example.invalid",
            email_verified=True,
        )
    )
    client.headers["Authorization"] = "Bearer synthetic-admin-token"
    return client


def test_alethical_com_answers_are_identical_with_and_without_finance_checks(
    admin, listed, source, held, monkeypatch
):
    db = listed
    # The review screen reads the folder listing from file storage.
    monkeypatch.setattr(review, "raw_file_store_from_env", lambda *args: source[1])
    document = held["document"]
    facility, file_id = reader.identity(held["second"])
    second = db.get(m.FCCDocument, (facility, file_id, held["second_version"]))
    # Everything Finance's checks need exists before the first reading: text on
    # each page quoted, and an older version of the second file.
    _read(db, document, {2: PAGE_2})
    older = m.FCCDocument(
        facility_id=second.facility_id,
        file_id=second.file_id,
        content_hash=fcc_archive.archive_body(db, MemoryStore(), pdf() + b"\n% older"),
        call_sign=second.call_sign,
        folder_id=second.folder_id,
        folder_path=second.folder_path,
        name="Second private title",
        url=second.url,
        year=2026,
        last_downloaded_at=second.last_downloaded_at - timedelta(days=1),
    )
    db.add(older)
    db.flush()
    _read(db, older, {1: "Agent: Northern Buying Group. Advertiser: Example Media."})
    copy = db.scalar(
        select(m.TVAdPublication).where(
            m.TVAdPublication.file_id == document.file_id,
            m.TVAdPublication.status == "approved",
        )
    )
    admin_paths = "/api/v1/admin/political-ads"
    paths = [
        "/api/v1/ads/counts",
        "/api/v1/ads/sources",
        "/api/v1/ads/recent",
        "/api/v1/ads/browse",
        "/api/v1/ads/browse?tab=agencies",
        "/api/v1/ads/browse?tab=stations",
        "/api/v1/ads/browse?tab=years",
        "/api/v1/ads/browse?q=Example",
        "/api/v1/ads/browse?q=Northern",
        f"/api/v1/ads/files/{held['key']}",
        f"/api/v1/ads/files/{held['key']}?version={document.content_hash}",
        f"/api/v1/ads/files/{held['second']}",
        f"/api/v1/ads/files/{held['second']}?version={older.content_hash}",
        f"/api/v1/ads/folders/{held['folder']}",
        f"/api/v1/ads/agencies/{reader.agency_key('Example Media')}",
        f"/api/v1/ads/agencies/{reader.agency_key('Northern Buying Group')}",
        "/api/v1/ads/stations/kstp-tv",
        "/api/v1/ads/connections?kind=committee&target=19002",
        "/api/v1/ads/connections?kind=name&target=Example%20Media",
        "/api/v1/ads/connections?kind=name&target=Northern%20Buying%20Group",
        f"{admin_paths}/queue",
        f"{admin_paths}/folders",
        f"{admin_paths}/copies/{copy.id}/review",
        f"{admin_paths}/copies/{copy.id}/suggestions",
        f"{admin_paths}/files/{facility}/{document.file_id}/versions/{document.content_hash}",
    ]

    def answers():
        return {
            path: (r.status_code, r.content)
            for path in paths
            for r in [admin.get(path)]
        }

    # A refused request rolls the session back to its last commit.
    db.commit()
    before = answers()
    assert all(status in (200, 404) for status, _ in before.values()), before
    # Finance checks of every kind: on the approved copy's own version, on an
    # older version of another file, corrected and withdrawn.
    key, version = held["key"], document.content_hash
    name = checks.add_fact(
        db,
        TEAM,
        key,
        version,
        _fact(
            page=2, value="Northern Buying Group", quote="Agent: Northern Buying Group."
        ),
    )
    checks.add_fact(db, CLIENT, key, version, _fact())
    checks.add_fact(
        db,
        CLIENT,
        key,
        version,
        _fact(
            page=2,
            value="Northern Buying Group",
            quote="Agent: Northern Buying Group.",
            supersedes_id=str(name.id),
        ),
    )
    checks.add_fact(
        db,
        TEAM,
        held["second"],
        older.content_hash,
        _fact(value="Example Media", quote="Advertiser: Example Media."),
    )
    _connect(db, document, "committee", "19002", quote="Agency: Example Media.")
    _connect(
        db,
        older,
        "committee",
        "19002",
        quote="Agent: Northern Buying Group.",
        account=TEAM,
    )
    withdrawn = _connect(
        db,
        document,
        "related_document",
        f"{held['second']}@{second.content_hash}",
        quote="Agency: Example Media.",
    )
    checks.withdraw(db, m.FinanceTVConnection, withdrawn.id, "Not related")
    # Every kind of public-copy check can also be withdrawn in Finance, without
    # changing any public route, including copy review and suggestions.
    for copied in db.scalars(select(m.TVAdFact).where(m.TVAdFact.status == "checked")):
        checks.withdraw(db, m.FinanceTVFact, copied.id, "Finance-only correction")
    for copied in db.scalars(
        select(m.TVAdConnection).where(m.TVAdConnection.status == "checked")
    ):
        checks.withdraw(db, m.FinanceTVConnection, copied.id, "Finance-only correction")
    db.commit()
    assert answers() == before
    # The checks were present for the whole second reading.
    assert db.scalar(select(func.count()).select_from(m.FinanceTVFact)) == 4
    assert db.scalar(select(func.count()).select_from(m.FinanceTVConnection)) == 3


def test_checking_needs_finance_access_and_names_the_broken_rule(
    client, finance_api, original
):
    url = f"{BASE}/files/{original.key}/versions/{original.version}"
    signed_out = client.__class__(client.app)
    assert signed_out.post(f"{url}/facts", json=_fact()).status_code == 401
    refused = finance_api.post(f"{url}/facts", json=_fact(page=2))
    assert refused.status_code == 422
    # The rule's own sentence, so a person can fix the check.
    assert refused.json()["detail"] == (
        "Quotation must appear in this original's machine-read text on that page"
    )
    saved = finance_api.post(f"{url}/facts", json=_fact()).json()["data"]
    withdraw = f"{BASE}/facts/{saved['id']}/withdraw"
    assert finance_api.post(withdraw, json={"why": "x"}).status_code == 422
    done = finance_api.post(withdraw, json={"reason": "Wrong file"})
    assert done.json()["data"] == {"id": saved["id"], "status": "withdrawn"}
    again = finance_api.post(withdraw, json={"reason": "Again"})
    assert (again.status_code, again.json()["detail"]) == (
        422,
        "This check is already withdrawn",
    )
    missing = f"{BASE}/connections/{uuid.uuid4()}/withdraw"
    assert finance_api.post(missing, json={"reason": "x"}).status_code == 404


EXPENSE_TOO_FAR = f"expenditures:{uuid.uuid4()}:" + "9" * 40


@pytest.mark.parametrize(
    ("path", "body", "detail"),
    [
        # A field of the wrong type is refused by name, never a server error.
        ("facts", _fact(field=["agency_name"]), "field must be text"),
        ("facts", _fact(field={"name": "agency_name"}), "field must be text"),
        (
            "facts",
            _fact(correctness_reviewed="yes"),
            "correctness_reviewed must be true or false",
        ),
        ("connections", {"kind": ["committee"]}, "kind must be text"),
        (
            "connections",
            {"kind": "candidate", "role": ["advertiser"]},
            "role must be text",
        ),
        # Values the database cannot hold are refused before it is asked.
        ("facts", _fact(page=10**30), "Choose an exact source page"),
        ("facts", _fact(page=101), "Choose an exact source page"),
        (
            "facts",
            _fact(evidence="Read\x00on page 1"),
            "evidence must not contain a NUL character",
        ),
        (
            "facts",
            _fact(field="document_kind", value="Invoice\x00"),
            "value must not contain a NUL character",
        ),
        (
            "connections",
            {
                "kind": "expense",
                "target_id": EXPENSE_TOO_FAR,
                "page": 1,
                "quote": "Gross amount: $1,250.",
                "evidence": "Read",
                "correctness_reviewed": True,
                "file_identity_reviewed": True,
            },
            "Expense row number is beyond any held row",
        ),
    ],
)
def test_mistyped_or_unstorable_input_is_refused_by_rule(
    finance_api, original, path, body, detail
):
    url = f"{BASE}/files/{original.key}/versions/{original.version}/{path}"
    response = finance_api.post(url, json=body)
    assert (response.status_code, response.json()["detail"]) == (422, detail)


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        (
            {"kind": "expense", "target_id": EXPENSE_TOO_FAR},
            "Expense row number is beyond any held row",
        ),
        (
            {"kind": "committee", "target_id": "190\x0002"},
            "target_id must not contain a NUL character",
        ),
    ],
)
def test_a_preview_refuses_unstorable_input_by_rule(
    finance_api, original, params, detail
):
    url = f"{BASE}/files/{original.key}/versions/{original.version}/target-preview"
    response = finance_api.get(url, params=params)
    assert (response.status_code, response.json()["detail"]) == (422, detail)


def test_a_withdrawal_reason_with_a_nul_is_refused_by_rule(finance_api, original):
    url = f"{BASE}/files/{original.key}/versions/{original.version}/facts"
    saved = finance_api.post(url, json=_fact()).json()["data"]
    response = finance_api.post(
        f"{BASE}/facts/{saved['id']}/withdraw", json={"reason": "Wrong\x00file"}
    )
    assert (response.status_code, response.json()["detail"]) == (
        422,
        "reason must not contain a NUL character",
    )


def test_a_correction_that_loses_a_race_answers_409(finance_api, original, monkeypatch):
    def lost(*args, **kwargs):
        raise checks.CorrectionRace

    monkeypatch.setattr(checks, "add_fact", lost)
    url = f"{BASE}/files/{original.key}/versions/{original.version}/facts"
    response = finance_api.post(url, json=_fact())
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "This fact was corrected a moment ago. Reload and check.",
    )


def test_2_simultaneous_corrections_keep_the_first_and_refuse_the_second():
    """2 real database sessions correct 1 fact at once: the second waits on the
    first's lock, then finds the first correction already saved."""
    factory = get_session_factory()
    store = MemoryStore()
    setup = factory()
    digest = fcc_archive.archive_body(setup, store, pdf() + b"\n% race")
    document = m.FCCDocument(
        facility_id="28010",
        file_id=str(uuid.uuid4()),
        content_hash=digest,
        call_sign="KSTP-TV",
        folder_id="folder-race",
        folder_path="political-files/2026/folder-race",
        name="Race original",
        url="https://files.fcc.gov/race.pdf",
    )
    setup.add(document)
    setup.flush()
    _read(setup, document, {1: PAGE_1})
    key = _key(document)
    old = checks.add_fact(setup, CLIENT, key, digest, _fact())
    setup.commit()
    first, second = factory(), factory()
    try:
        checks.add_fact(first, CLIENT, key, digest, _fact(supersedes_id=str(old.id)))
        pid = second.scalar(text("SELECT pg_backend_pid()"))
        outcome = {}

        def correct():
            try:
                checks.add_fact(
                    second, TEAM, key, digest, _fact(supersedes_id=str(old.id))
                )
            except Exception as error:  # noqa: BLE001 -- the outcome under test
                outcome["error"] = error

        racer = threading.Thread(target=correct)
        racer.start()
        with factory() as watcher:
            for _ in range(200):
                waiting = watcher.scalar(
                    text(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid"
                    ),
                    {"pid": pid},
                )
                if waiting == "Lock":
                    break
                time.sleep(0.05)
        assert waiting == "Lock"
        first.commit()
        racer.join(10)
        assert isinstance(outcome.get("error"), checks.CorrectionRace)
        second.rollback()
        with factory() as check:
            assert (
                check.scalar(
                    select(func.count())
                    .select_from(m.FinanceTVFact)
                    .where(m.FinanceTVFact.supersedes_id == old.id)
                )
                == 1
            )
    finally:
        first.rollback()
        second.rollback()
        first.close()
        second.close()
        # Rows committed here are this test's own; nothing else holds them.
        setup.rollback()
        setup.execute(text("TRUNCATE finance_tv_fact, finance_tv_connection"))
        for model in (m.FCCPage, m.FCCExtraction, m.FCCDocument, m.FCCSourceBody):
            setup.execute(
                model.__table__.delete().where(model.__table__.c.content_hash == digest)
            )
        setup.commit()
        setup.close()


def test_copy_checks_can_be_withdrawn_in_finance_without_changing_public_answers(
    finance_api, listed, held
):
    key = held["key"]
    db = listed
    source_facts = [
        (row.id, row.status, row.withdrawn_at) for row in db.scalars(select(m.TVAdFact))
    ]
    source_connections = [
        (row.id, row.status, row.withdrawn_at)
        for row in db.scalars(select(m.TVAdConnection))
    ]
    detail = finance_api.get(f"{BASE}/files/{key}").json()["data"]
    ids = {
        "facts": [item["id"] for item in detail["facts"] + detail["dates"]],
        "connections": [item["id"] for item in detail["connections"]],
    }
    for kind, check_ids in ids.items():
        for check_id in check_ids:
            response = finance_api.post(
                f"{BASE}/{kind}/{check_id}/withdraw",
                json={"reason": "Wrong file, checked against the original"},
            )
            assert response.status_code == 200, response.text
            assert response.json()["data"] == {"id": check_id, "status": "withdrawn"}
            again = finance_api.post(
                f"{BASE}/{kind}/{check_id}/withdraw", json={"reason": "Again"}
            )
            assert again.status_code == 422
    after = finance_api.get(f"{BASE}/files/{key}").json()["data"]
    assert all(
        item["status"] == "withdrawn"
        for item in after["facts"] + after["dates"] + after["connections"]
    )
    assert not any(
        item.get("value") or item.get("target")
        for item in after["facts"] + after["dates"] + after["connections"]
    )
    assert (
        finance_api.get(f"{BASE}/counts").json()["data"]["checked_connection_files"]
        == 0
    )
    assert (
        finance_api.get(
            f"{BASE}/connections", params={"kind": "committee", "target": "19002"}
        ).json()["data"]["files"]
        == []
    )
    assert [
        (row.id, row.status, row.withdrawn_at) for row in db.scalars(select(m.TVAdFact))
    ] == source_facts
    assert [
        (row.id, row.status, row.withdrawn_at)
        for row in db.scalars(select(m.TVAdConnection))
    ] == source_connections
    for statement in (
        "UPDATE finance_tv_copy_withdrawal SET withdrawal_reason = 'Changed'",
        "DELETE FROM finance_tv_copy_withdrawal",
    ):
        with pytest.raises(DBAPIError, match="immutable"):
            with db.begin_nested():
                db.execute(text(statement))


def test_folder_checks_withdraw_only_in_finance_and_draft_facts_are_refused(
    finance_api, listed, held
):
    db = listed
    detail = finance_api.get(f"{BASE}/folders/{held['folder']}").json()["data"]
    check_id = detail["relationship"]["id"]
    original = db.get(m.TVAdConnection, uuid.UUID(check_id))
    assert original.scope == "folder" and original.status == "checked"
    response = finance_api.post(
        f"{BASE}/connections/{check_id}/withdraw", json={"reason": "Wrong folder"}
    )
    assert response.status_code == 200, response.text
    assert (
        finance_api.get(f"{BASE}/folders/{held['folder']}").json()["data"][
            "relationship"
        ]
        is None
    )
    assert original.status == "checked" and original.withdrawn_at is None
    copy = db.scalar(
        select(m.TVAdPublication).where(
            m.TVAdPublication.file_id == held["document"].file_id
        )
    )
    copied = db.scalar(select(m.TVAdFact).where(m.TVAdFact.publication_id == copy.id))
    copy.status = "draft"
    db.flush()
    with pytest.raises(LookupError):
        checks.withdraw(db, m.FinanceTVFact, copied.id, "Not a shown check")


def test_finance_withdrawal_removes_a_copy_facts_history_only_in_finance(original):
    db, key = original.db, original.key
    copy = approved(db, (original.document, original.store))
    old = review.add_fact(db, copy.id, ACTOR, fact())
    new = review.add_fact(
        db,
        copy.id,
        ACTOR,
        {**fact(), "supersedes_id": str(old.id), "qualifier": "Agency as printed"},
    )
    # Corrected values can be withdrawn from Finance history independently.
    checks.withdraw(db, m.FinanceTVFact, old.id, "Wrong value")
    standing = next(
        item
        for item in media.file_detail(db, key)["facts"]
        if item["id"] == str(new.id)
    )
    assert standing["history"] == []
    assert db.get(m.TVAdFact, old.id).value == "Example Media"
